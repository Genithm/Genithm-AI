from __future__ import annotations

import argparse
import json
import sys
import time
from dataclasses import dataclass
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen


@dataclass(frozen=True)
class CheckResult:
    name: str
    ok: bool
    detail: str


def _validate_base_url(value: str, *, allow_http: bool) -> str:
    parsed = urlparse(value)
    allowed_schemes = {"https"} | ({"http"} if allow_http else set())
    if parsed.scheme not in allowed_schemes:
        raise ValueError("base URL must use HTTPS")
    if not parsed.netloc or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError("base URL must be a plain origin/path without credentials, query, or fragment")
    return value.rstrip("/")


def _request_json(url: str, *, timeout_seconds: float, attempts: int) -> tuple[int, dict[str, Any], dict[str, str]]:
    last_error: Exception | None = None
    for attempt in range(1, attempts + 1):
        request = Request(
            url,
            method="GET",
            headers={"Accept": "application/json", "User-Agent": "genithm-release-smoke/1.1"},
        )
        try:
            with urlopen(request, timeout=timeout_seconds) as response:
                payload = json.loads(response.read().decode("utf-8"))
                if not isinstance(payload, dict):
                    raise ValueError("JSON response must be an object")
                headers = {key.lower(): value for key, value in response.headers.items()}
                return response.status, payload, headers
        except HTTPError as exc:
            try:
                payload = json.loads(exc.read().decode("utf-8"))
            except (json.JSONDecodeError, UnicodeDecodeError):
                payload = {}
            if not isinstance(payload, dict):
                payload = {}
            headers = {key.lower(): value for key, value in exc.headers.items()}
            return exc.code, payload, headers
        except (URLError, TimeoutError, json.JSONDecodeError, UnicodeDecodeError, ValueError) as exc:
            last_error = exc
            if attempt < attempts:
                time.sleep(min(attempt, 2))
    raise RuntimeError(f"request failed after {attempts} attempts: {type(last_error).__name__}")


def _check_security_headers(headers: dict[str, str]) -> list[str]:
    missing: list[str] = []
    expected = {
        "x-content-type-options": "nosniff",
        "x-frame-options": "DENY",
        "referrer-policy": "strict-origin-when-cross-origin",
        "cache-control": "no-store",
    }
    for key, expected_value in expected.items():
        if headers.get(key, "").lower() != expected_value.lower():
            missing.append(key)
    return missing


def run_api_checks(base_url: str, *, timeout_seconds: float, attempts: int) -> list[CheckResult]:
    results: list[CheckResult] = []

    try:
        status, payload, headers = _request_json(
            f"{base_url}/api/v1/health", timeout_seconds=timeout_seconds, attempts=attempts
        )
        valid = status == 200 and payload == {"status": "ok", "service": "genithm-api"}
        results.append(CheckResult("api_health", valid, f"http={status} service={payload.get('service', 'missing')}"))
        missing_headers = _check_security_headers(headers)
        results.append(
            CheckResult(
                "api_security_headers",
                not missing_headers,
                "ok" if not missing_headers else "invalid=" + ",".join(sorted(missing_headers)),
            )
        )
    except RuntimeError as exc:
        results.append(CheckResult("api_health", False, str(exc)))
        results.append(CheckResult("api_security_headers", False, "health endpoint unavailable"))

    try:
        status, payload, _ = _request_json(
            f"{base_url}/api/v1/ready", timeout_seconds=timeout_seconds, attempts=attempts
        )
        missing_workers = payload.get("missing_workers") or []
        stale_workers = payload.get("stale_workers") or []
        missing_queues = payload.get("missing_queues") or []
        stale_queues = payload.get("stale_queues") or []
        expected_workers = payload.get("expected_worker_count")
        expected_queues = payload.get("expected_queue_count")
        ready = (
            status == 200
            and payload.get("status") == "ready"
            and expected_workers == 6
            and expected_queues == 9
            and not missing_workers
            and not stale_workers
            and not missing_queues
            and not stale_queues
        )
        detail_parts = [
            f"http={status}",
            f"status={payload.get('status', 'missing')}",
            f"workers={expected_workers}",
            f"queues={expected_queues}",
        ]
        if missing_workers:
            detail_parts.append("missing_workers=" + ",".join(str(item) for item in missing_workers))
        if stale_workers:
            detail_parts.append("stale_workers=" + ",".join(str(item) for item in stale_workers))
        if missing_queues:
            detail_parts.append("missing_queues=" + ",".join(str(item) for item in missing_queues))
        if stale_queues:
            detail_parts.append("stale_queues=" + ",".join(str(item) for item in stale_queues))
        if payload.get("reason"):
            detail_parts.append(f"reason={payload.get('reason')}")
        results.append(CheckResult("api_readiness", ready, " ".join(detail_parts)))
    except RuntimeError as exc:
        results.append(CheckResult("api_readiness", False, str(exc)))

    return results


def run_web_checks(base_url: str, *, timeout_seconds: float, attempts: int) -> list[CheckResult]:
    results: list[CheckResult] = []
    try:
        status, payload, headers = _request_json(
            f"{base_url}/api/health", timeout_seconds=timeout_seconds, attempts=attempts
        )
        valid = status == 200 and payload == {"status": "ok", "service": "genithm-web"}
        results.append(CheckResult("web_health", valid, f"http={status} service={payload.get('service', 'missing')}"))
        missing_headers = _check_security_headers(headers)
        results.append(
            CheckResult(
                "web_security_headers",
                not missing_headers,
                "ok" if not missing_headers else "invalid=" + ",".join(sorted(missing_headers)),
            )
        )
    except RuntimeError as exc:
        results.append(CheckResult("web_health", False, str(exc)))
        results.append(CheckResult("web_security_headers", False, "health endpoint unavailable"))
    return results


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run secretless post-deploy Genithm production smoke checks.")
    parser.add_argument("--api-base-url", required=True, help="Deployed Genithm API origin, e.g. https://api.example.com")
    parser.add_argument("--web-base-url", help="Optional deployed Genithm web origin")
    parser.add_argument("--timeout-seconds", type=float, default=5.0)
    parser.add_argument("--attempts", type=int, default=3)
    parser.add_argument("--allow-http", action="store_true", help="Allow HTTP for local/non-production testing only")
    return parser


def main() -> int:
    args = _build_parser().parse_args()
    if not 0.5 <= args.timeout_seconds <= 30:
        print("timeout must be between 0.5 and 30 seconds", file=sys.stderr)
        return 2
    if not 1 <= args.attempts <= 5:
        print("attempts must be between 1 and 5", file=sys.stderr)
        return 2

    try:
        api_base_url = _validate_base_url(args.api_base_url, allow_http=args.allow_http)
        web_base_url = (
            _validate_base_url(args.web_base_url, allow_http=args.allow_http) if args.web_base_url else None
        )
    except ValueError as exc:
        print(f"invalid smoke target: {exc}", file=sys.stderr)
        return 2

    results = run_api_checks(api_base_url, timeout_seconds=args.timeout_seconds, attempts=args.attempts)
    if web_base_url:
        results.extend(run_web_checks(web_base_url, timeout_seconds=args.timeout_seconds, attempts=args.attempts))

    for result in results:
        marker = "PASS" if result.ok else "FAIL"
        print(f"[{marker}] {result.name}: {result.detail}")

    if all(result.ok for result in results):
        print("Production smoke checks passed.")
        return 0
    print("Production smoke checks failed.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
