#!/usr/bin/env python3
"""Check direct Gemini/Groq accounts without printing keys, prompts or responses.

The default checks model discovery only. --inference makes one small structured
request to EACH provider (no substituted fallback) and consumes provider quota.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import HTTPRedirectHandler, Request, build_opener

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "apps" / "ai-worker"))
from genithm_ai_worker.providers import (  # noqa: E402
    OpenAICompatibleProvider, ProviderHttpError, provider_configs_from_env,
)

MAX_BYTES = 2 * 1024 * 1024
MODEL_URLS = {
    "gemini": "https://generativelanguage.googleapis.com/v1beta/models",
    "groq": "https://api.groq.com/openai/v1/models",
}


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def urlopen(req, *, timeout):
    return build_opener(_NoRedirect()).open(req, timeout=timeout)


def safe_http_error(name: str, status: int) -> str:
    if status in (401, 403):
        return f"{name}: authentication or model permission denied (HTTP {status})"
    if status in (402, 429):
        return f"{name}: quota/rate limit or billing needs attention (HTTP {status})"
    if status == 404:
        return f"{name}: configured model or API endpoint was not found (HTTP 404)"
    if status == 400:
        return f"{name}: provider rejected the configured request (HTTP 400)"
    return f"{name}: provider request failed (HTTP {status})"


def model_available(provider) -> None:
    """Inspect all bounded Google model pages; the desired model may not be on page one."""
    token = ""
    seen: set[str] = set()
    for _ in range(10):
        query = {"pageSize": "1000"} if provider.name == "gemini" else {}
        if token:
            query["pageToken"] = token
        url = MODEL_URLS[provider.name] + ("?" + urlencode(query) if query else "")
        headers = {"Accept": "application/json"}
        if provider.name == "gemini":
            headers["x-goog-api-key"] = provider.api_key
        else:
            headers["Authorization"] = "Bearer " + provider.api_key
        try:
            with urlopen(Request(url, headers=headers), timeout=12) as response:
                raw = response.read(MAX_BYTES + 1)
            if len(raw) > MAX_BYTES:
                raise ValueError("oversized model catalogue")
            result = json.loads(raw)
            if not isinstance(result, dict):
                raise ValueError("invalid model catalogue")
            entries = result.get("models" if provider.name == "gemini" else "data")
            if not isinstance(entries, list) or any(not isinstance(x, dict) for x in entries):
                raise ValueError("invalid model records")
        except HTTPError as error:
            error.close()
            raise RuntimeError(safe_http_error(provider.name, error.code)) from None
        except (URLError, TimeoutError, OSError, ValueError, UnicodeError):
            raise RuntimeError(f"{provider.name}: unable to verify model catalogue; check network and account configuration") from None
        names = {str(x.get("name", x.get("id", ""))).removeprefix("models/") for x in entries}
        if provider.model in names:
            return
        token = result.get("nextPageToken", "") if provider.name == "gemini" else ""
        if not token:
            break
        if not isinstance(token, str) or len(token) > 4096 or token in seen:
            raise RuntimeError(f"{provider.name}: invalid model catalogue pagination")
        seen.add(token)
    raise RuntimeError(f"{provider.name}: configured model {provider.model} is not listed for this account")


def inference_probe(provider) -> dict[str, object]:
    """Use Genithm's actual structured adapter and validator, not a hand-written substitute."""
    client = OpenAICompatibleProvider(provider, timeout_seconds=30)
    started = time.monotonic()
    schema = {"type": "object", "properties": {"ready": {"type": "boolean", "enum": [True]}},
              "required": ["ready"], "additionalProperties": False}
    try:
        client.structured_response(
            instructions='This is a harmless connectivity test. Return only JSON {"ready":true}.',
            input_text="Confirm this API account can return structured JSON. No tools or user data are involved.",
            schema_name="genithm_account_readiness", schema=schema,
        )
    except ProviderHttpError as error:
        status = re.fullmatch(r"HTTP (\d{3})", str(error))
        message = safe_http_error(provider.name, int(status.group(1))) if status else f"{provider.name}: inference did not produce a complete valid result"
        raise RuntimeError(message) from None
    except (ValueError, TypeError, OverflowError):
        raise RuntimeError(f"{provider.name}: inference configuration or result validation failed") from None
    return {"provider": provider.name, "configured_model": provider.model,
            "returned_model": client.model, "inference": "passed",
            "elapsed_ms": round((time.monotonic() - started) * 1000)}


def run_checks(*, inference: bool = False) -> list[dict[str, object]]:
    try:
        primary, secondary = provider_configs_from_env()
    except ValueError:
        raise RuntimeError("GEMINI_API_KEY/GROQ_API_KEY or model configuration is missing/invalid; add Codespaces secrets and restart the Codespace") from None
    if secondary is None:
        raise RuntimeError("GROQ_API_KEY is missing; both approved providers are required by this development check")
    results = []
    failures = []
    for provider in (primary, secondary):
        try:
            model_available(provider)
            row = inference_probe(provider) if inference else {
                "provider": provider.name, "configured_model": provider.model, "inference": "not_tested",
            }
            row["model_discovery"] = "passed"
            results.append(row)
            print(json.dumps(row, sort_keys=True))
        except RuntimeError as error:
            # These errors are constructed from fixed messages, never a vendor response body.
            failures.append(str(error))
    if failures:
        raise RuntimeError("; ".join(failures))
    return results


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--inference", action="store_true", help="Make two small API requests using the actual worker adapters; uses quota")
    args = parser.parse_args()
    try:
        run_checks(inference=args.inference)
    except RuntimeError as error:
        print(str(error), file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
