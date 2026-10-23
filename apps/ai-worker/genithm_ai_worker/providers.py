from __future__ import annotations

import json
import math
import os
import re
import sys
from dataclasses import dataclass
from typing import Any, Callable, Mapping, Protocol, TypeVar
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener

USER_AGENT = "genithm-ai-worker/0.6.0"
ENDPOINTS = {"gemini": "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", "groq": "https://api.groq.com/openai/v1/chat/completions"}
DEFAULT_MODELS = {"gemini": "gemini-3.8-flash", "groq": "llama-3.3-70b-versatile"}


class ProviderHttpError(RuntimeError):
    def __init__(self, message: str, *, retryable: bool, fallback_allowed: bool | None = None) -> None:
        super().__init__(message)
        self.retryable = retryable
        self.fallback_allowed = retryable if fallback_allowed is None else fallback_allowed


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def urlopen(request, *, timeout):
    return build_opener(_NoRedirect()).open(request, timeout=timeout)


def strict_json(value):
    def pairs(items):
        result = {}
        for name, item in items:
            if name in result:
                raise ValueError("Duplicate JSON field")
            result[name] = item
        return result
    return json.loads(value, object_pairs_hook=pairs, parse_constant=lambda v: (_ for _ in ()).throw(ValueError("Non-finite JSON value")))


def validate_schema(value, schema, depth=0):
    """Reject invalid structured output locally; domain and DB policy still run separately."""
    if not isinstance(schema, dict) or depth > 40:
        raise ValueError("Unsupported schema")
    supported = {"type","properties","required","additionalProperties","items","enum","const","anyOf","oneOf","allOf","minLength","maxLength","minimum","maximum","minItems","maxItems","pattern","uniqueItems","description","title","$schema","default"}
    if set(schema) - supported:
        raise ValueError("Unsupported schema keyword")
    for kind in ("anyOf","oneOf","allOf"):
        if kind in schema:
            passed = 0
            for branch in schema[kind]:
                try:
                    validate_schema(value,branch,depth+1)
                    passed += 1
                except ValueError:
                    pass
            if passed != (len(schema[kind]) if kind=="allOf" else 1) and not (kind=="anyOf" and passed>0):
                raise ValueError("Schema alternatives mismatch")
    wanted = schema.get("type")
    if wanted is not None:
        types = wanted if isinstance(wanted,list) else [wanted]
        checks = {"null": value is None, "boolean": type(value) is bool,"integer":type(value) is int,
                  "number":type(value) in (float,int) and math.isfinite(value),
                  "string":isinstance(value,str),"object":isinstance(value,dict),"array":isinstance(value,list)}
        if any(t not in checks for t in types) or not any(checks[t] for t in types):
            raise ValueError("Schema type mismatch")
    canon = json.dumps(value,sort_keys=True,allow_nan=False)
    if "enum" in schema and canon not in [json.dumps(v,sort_keys=True,allow_nan=False) for v in schema["enum"]]:
        raise ValueError("Schema enum mismatch")
    if "const" in schema and canon != json.dumps(schema["const"],sort_keys=True,allow_nan=False):
        raise ValueError("Schema constant mismatch")
    if isinstance(value,dict):
        if not set(schema.get("required",[])) <= set(value):
            raise ValueError("Missing required fields")
        properties = schema.get("properties",{})
        for name,item in value.items():
            if name in properties:
                validate_schema(item,properties[name],depth+1)
            elif schema.get("additionalProperties") is False:
                raise ValueError("Unexpected field")
            elif isinstance(schema.get("additionalProperties"),dict):
                validate_schema(item,schema["additionalProperties"],depth+1)
    if isinstance(value,list):
        if len(value)<schema.get("minItems",0) or len(value)>schema.get("maxItems",math.inf):
            raise ValueError("Array size mismatch")
        if schema.get("uniqueItems") and len({json.dumps(v,sort_keys=True) for v in value})!=len(value):
            raise ValueError("Repeated array items")
        if "items" in schema:
            for item in value: validate_schema(item,schema["items"],depth+1)
    if isinstance(value,str):
        if len(value)<schema.get("minLength",0) or len(value)>schema.get("maxLength",math.inf):
            raise ValueError("String length mismatch")
        if "pattern" in schema and not re.search(schema["pattern"],value):
            raise ValueError("String pattern mismatch")
    if type(value) in (int,float):
        if not math.isfinite(value) or value<schema.get("minimum",-math.inf) or value>schema.get("maximum",math.inf):
            raise ValueError("Numeric bound mismatch")


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
        body = json.dumps(payload, separators=(",", ":"), ensure_ascii=True, allow_nan=False).encode("utf-8")
        request = Request(url, data=body, method=method, headers=headers)
        try:
            with urlopen(request, timeout=timeout) as response:
                raw = response.read(max_bytes + 1)
        except HTTPError as exc:
            exc.close()
            retryable = exc.code in {408,409,425,429,500,502,503,504}
            raise ProviderHttpError(f"HTTP {exc.code}", retryable=retryable, fallback_allowed=retryable or exc.code in {401,402,403,404}) from None
        except (URLError, TimeoutError, OSError):
            raise ProviderHttpError("network connection failed", retryable=True, fallback_allowed=True) from None
        if len(raw)>max_bytes:
            raise ProviderHttpError("provider response exceeded the permitted size", retryable=False,fallback_allowed=True)
        try:
            return strict_json(raw)
        except (ValueError,UnicodeError):
            raise ProviderHttpError("provider returned invalid JSON",retryable=False,fallback_allowed=True) from None


@dataclass(frozen=True, slots=True)
class ProviderConfig:
    name: str
    api_key: str
    endpoint: str
    model: str
    protocol: str

    def __post_init__(self) -> None:
        if self.name not in ENDPOINTS or self.endpoint != ENDPOINTS.get(self.name):
            raise ValueError("Only Gemini and Groq fixed API endpoints are allowed")
        if self.protocol != "chat_completions":
            raise ValueError("Only chat completions wire format is allowed")
        if not self.api_key or len(self.api_key)>4096 or any(c in self.api_key for c in "\r\n"):
            raise ValueError("AI provider key is absent or invalid")
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}",self.model):
            raise ValueError("AI model ID is invalid")
        if self.name=="gemini" and not self.model.startswith("gemini-"):
            raise ValueError("Gemini requires a Gemini model")


def provider_configs_from_env(env: Mapping[str,str] | None = None) -> tuple[ProviderConfig,ProviderConfig | None]:
    env = os.environ if env is None else env
    primary = ProviderConfig("gemini",env.get("GEMINI_API_KEY","").strip(),ENDPOINTS["gemini"],
                             env.get("GENITHM_GEMINI_MODEL",DEFAULT_MODELS["gemini"]).strip(),"chat_completions")
    groq_key = env.get("GROQ_API_KEY","").strip()
    secondary = ProviderConfig("groq",groq_key,ENDPOINTS["groq"],
                               env.get("GENITHM_GROQ_MODEL",DEFAULT_MODELS["groq"]).strip(),"chat_completions") if groq_key else None
    return primary, secondary


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
    """Compatible JSON wire format. Only Google's and Groq's fixed endpoints are used."""
    def __init__(self, config: ProviderConfig, *, timeout_seconds: float) -> None:
        self.config,self.name,self.model,self.timeout_seconds=config,config.name,config.model,timeout_seconds

    def _headers(self) -> dict[str,str]:
        return {"Authorization":f"Bearer {self.config.api_key}","Content-Type":"application/json",
                "Accept":"application/json","User-Agent":USER_AGENT}

    def structured_response(self, *, instructions: str, input_text: str, schema_name: str, schema: dict[str,Any]) -> dict[str,Any]:
        if self.name=="gemini":
            format={"type":"json_schema","json_schema":{"name":schema_name,"strict":True,"schema":schema}}
        else:
            format={"type":"json_object"}
            instructions+="\nReturn only JSON conforming to this schema. No markdown:\n"+json.dumps(schema,separators=(",",":"))
        payload={
            "model":self.config.model,
            "messages":[{"role":"system","content":instructions},{"role":"user","content":input_text}],
            "response_format":format,
            "max_tokens":8192 if self.name=="gemini" else 4096,
        }
        if self.name=="gemini": payload["reasoning_effort"]="medium"
        response=JsonHttpClient.request(self.config.endpoint,method="POST",headers=self._headers(),payload=payload,timeout=self.timeout_seconds)
        try:
            if not isinstance(response,dict) or len(response["choices"])!=1: raise ValueError("Invalid choices")
            choice=response["choices"][0]
            message=choice["message"]
            if choice.get("finish_reason") in ("content_filter","safety") or message.get("refusal"):
                raise ProviderHttpError("provider declined the request",retryable=False,fallback_allowed=False)
            if choice.get("finish_reason")!="stop" or message.get("tool_calls"):
                raise ValueError("Incomplete output")
            content=message["content"]
            if not isinstance(content,str) or not content.strip(): raise ValueError("Empty output")
            parsed=strict_json(content)
            if not isinstance(parsed,dict): raise ValueError("Expected JSON object")
            validate_schema(parsed,schema)
            actual_model=response.get("model",self.config.model)
            if not isinstance(actual_model,str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}",actual_model):
                raise ValueError("Invalid model provenance")
            self.model=actual_model
            return {"output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":content}]}]}
        except (KeyError,IndexError,TypeError,ValueError):
            raise ProviderHttpError("structured response failed integrity validation",retryable=False,fallback_allowed=True) from None


T = TypeVar("T")


class ProviderRouter:
    def __init__(self, primary: StructuredProvider, backup: StructuredProvider | None = None) -> None:
        if primary.name != "gemini" or (backup is not None and backup.name != "groq"):
            raise ValueError("AI provider order must be Gemini then Groq")
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
                        "AI provider fallback: Gemini to Groq",
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
