from __future__ import annotations

import json
import sys
from dataclasses import dataclass
from typing import Any, Callable, Protocol, TypeVar
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

USER_AGENT = "genithm-ai-worker/0.4.0"


class ProviderHttpError(RuntimeError):
    def __init__(self, message: str, *, retryable: bool, fallback_allowed: bool | None = None) -> None:
        super().__init__(message)
        self.retryable = retryable
        self.fallback_allowed = retryable if fallback_allowed is None else fallback_allowed


class JsonHttpClient:
    @staticmethod
    def request(
        url: str,
        *,
        method: str,
        headers: dict[str, str],
        payload: dict[str, Any],
        timeout: float,
        max_bytes: int = 2 * 1024 * 1024,
    ) -> Any:
        body = json.dumps(payload, separators=(",", ":"), ensure_ascii=True).encode("utf-8")
        request = Request(url, data=body, method=method, headers=headers)
        try:
            with urlopen(request, timeout=timeout) as response:
                raw = response.read(max_bytes + 1)
        except HTTPError as exc:
            detail = exc.read(8192).decode("utf-8", "replace")
            retryable = exc.code in {408, 409, 425, 429, 500, 502, 503, 504}
            raise ProviderHttpError(
                f"HTTP {exc.code}: {detail[:1000]}",
                retryable=retryable,
                fallback_allowed=retryable,
            ) from exc
        except (URLError, TimeoutError) as exc:
            raise ProviderHttpError("network connection failed", retryable=True, fallback_allowed=True) from exc
        if len(raw) > max_bytes:
            raise ProviderHttpError(
                "response exceeded Genithm size limit",
                retryable=False,
                fallback_allowed=True,
            )
        if not raw:
            raise ProviderHttpError("provider returned an empty response", retryable=False, fallback_allowed=True)
        try:
            return json.loads(raw)
        except json.JSONDecodeError as exc:
            raise ProviderHttpError(
                "response was not valid JSON",
                retryable=False,
                fallback_allowed=True,
            ) from exc


@dataclass(frozen=True, slots=True)
class ProviderConfig:
    name: str
    api_key: str
    endpoint: str
    model: str
    protocol: str

    def __post_init__(self) -> None:
        if self.name not in {"qwen", "deepseek", "openai"}:
            raise ValueError(f"unsupported AI provider: {self.name}")
        if self.protocol not in {"chat_completions", "responses"}:
            raise ValueError(f"unsupported AI provider protocol: {self.protocol}")
        if not self.api_key or len(self.api_key) > 4096:
            raise ValueError(f"{self.name} API key is required")
        if not self.model or len(self.model) > 128 or any(ch.isspace() for ch in self.model):
            raise ValueError(f"{self.name} model is invalid")
        parsed = urlparse(self.endpoint)
        if (
            parsed.scheme != "https"
            or not parsed.netloc
            or parsed.username is not None
            or parsed.password is not None
            or parsed.query
            or parsed.fragment
        ):
            raise ValueError(f"{self.name} endpoint must be a clean https URL")


class StructuredProvider(Protocol):
    name: str
    model: str

    def structured_response(
        self,
        *,
        instructions: str,
        input_text: str,
        schema_name: str,
        schema: dict[str, Any],
    ) -> dict[str, Any]: ...


class OpenAICompatibleProvider:
    def __init__(self, config: ProviderConfig, *, timeout_seconds: float) -> None:
        self.config = config
        self.name = config.name
        self.model = config.model
        self.timeout_seconds = timeout_seconds

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.config.api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": USER_AGENT,
        }

    @staticmethod
    def _normalize_chat_completion(response: Any) -> dict[str, Any]:
        try:
            choices = response["choices"]
            content = choices[0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as exc:
            raise ProviderHttpError(
                "provider returned an invalid chat-completion shape",
                retryable=False,
                fallback_allowed=True,
            ) from exc
        if not isinstance(content, str) or not content.strip():
            raise ProviderHttpError(
                "provider returned empty structured content",
                retryable=False,
                fallback_allowed=True,
            )
        return {
            "output": [
                {
                    "type": "message",
                    "role": "assistant",
                    "content": [{"type": "output_text", "text": content}],
                }
            ]
        }

    def structured_response(
        self,
        *,
        instructions: str,
        input_text: str,
        schema_name: str,
        schema: dict[str, Any],
    ) -> dict[str, Any]:
        if self.config.protocol == "chat_completions":
            payload = {
                "model": self.config.model,
                "messages": [
                    {"role": "system", "content": instructions},
                    {"role": "user", "content": input_text},
                ],
                "response_format": {
                    "type": "json_schema",
                    "json_schema": {
                        "name": schema_name,
                        "strict": True,
                        "schema": schema,
                    },
                },
            }
            response = JsonHttpClient.request(
                self.config.endpoint,
                method="POST",
                headers=self._headers(),
                payload=payload,
                timeout=self.timeout_seconds,
            )
            return self._normalize_chat_completion(response)

        payload = {
            "model": self.config.model,
            "instructions": instructions,
            "input": input_text,
            "text": {
                "format": {
                    "type": "json_schema",
                    "name": schema_name,
                    "strict": True,
                    "schema": schema,
                }
            },
        }
        if self.config.name == "openai":
            payload["store"] = False
        response = JsonHttpClient.request(
            self.config.endpoint,
            method="POST",
            headers=self._headers(),
            payload=payload,
            timeout=self.timeout_seconds,
        )
        if not isinstance(response, dict):
            raise ProviderHttpError(
                "provider returned an invalid response shape",
                retryable=False,
                fallback_allowed=True,
            )
        return response


T = TypeVar("T")


class ProviderRouter:
    def __init__(self, primary: StructuredProvider, backup: StructuredProvider | None = None) -> None:
        if backup is not None and backup.name == primary.name:
            raise ValueError("primary and backup AI providers must be different")
        self.primary = primary
        self.backup = backup
        self.last_provider = primary.name
        self.last_model = primary.model

    def run(self, operation: Callable[[StructuredProvider], T]) -> T:
        providers = [self.primary]
        if self.backup is not None:
            providers.append(self.backup)

        failures: list[tuple[StructuredProvider, ProviderHttpError]] = []
        for index, provider in enumerate(providers):
            try:
                result = operation(provider)
            except ProviderHttpError as exc:
                failures.append((provider, exc))
                has_backup = index == 0 and len(providers) > 1
                if has_backup and exc.fallback_allowed:
                    print(
                        f"AI provider fallback: {provider.name} failed; trying {providers[1].name}",
                        file=sys.stderr,
                        flush=True,
                    )
                    continue
                if len(failures) == 1:
                    raise
                break
            self.last_provider = provider.name
            self.last_model = provider.model
            return result

        retryable = any(error.retryable for _, error in failures)
        summary = "; ".join(f"{provider.name}: {error}" for provider, error in failures)
        raise ProviderHttpError(
            f"all configured AI providers failed ({summary})",
            retryable=retryable,
            fallback_allowed=False,
        )
