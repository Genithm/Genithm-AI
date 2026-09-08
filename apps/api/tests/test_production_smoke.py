from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts import production_smoke


def test_validate_base_url_requires_https_by_default() -> None:
    assert production_smoke._validate_base_url("https://api.example.com", allow_http=False) == "https://api.example.com"
    with pytest.raises(ValueError):
        production_smoke._validate_base_url("http://api.example.com", allow_http=False)
    with pytest.raises(ValueError):
        production_smoke._validate_base_url("https://user:pass@api.example.com", allow_http=False)


def test_api_checks_accept_expected_health_and_ready_contract(monkeypatch: pytest.MonkeyPatch) -> None:
    responses = iter(
        [
            (
                200,
                {"status": "ok", "service": "genithm-api"},
                {
                    "x-content-type-options": "nosniff",
                    "x-frame-options": "DENY",
                    "referrer-policy": "strict-origin-when-cross-origin",
                    "cache-control": "no-store",
                },
            ),
            (
                200,
                {
                    "status": "ready",
                    "expected_queue_count": 9,
                    "missing_queues": [],
                    "stale_queues": [],
                    "total_backlog": 0,
                },
                {},
            ),
        ]
    )
    monkeypatch.setattr(production_smoke, "_request_json", lambda *args, **kwargs: next(responses))

    results = production_smoke.run_api_checks("https://api.example.com", timeout_seconds=1, attempts=1)

    assert [result.name for result in results] == ["api_health", "api_security_headers", "api_readiness"]
    assert all(result.ok for result in results)


def test_api_checks_fail_on_not_ready_without_exposing_payload(monkeypatch: pytest.MonkeyPatch) -> None:
    responses = iter(
        [
            (
                200,
                {"status": "ok", "service": "genithm-api"},
                {
                    "x-content-type-options": "nosniff",
                    "x-frame-options": "DENY",
                    "referrer-policy": "strict-origin-when-cross-origin",
                    "cache-control": "no-store",
                },
            ),
            (
                503,
                {
                    "status": "not_ready",
                    "missing_queues": ["ai_planning"],
                    "stale_queues": [],
                    "unexpected_sensitive_field": "must-not-be-printed",
                },
                {},
            ),
        ]
    )
    monkeypatch.setattr(production_smoke, "_request_json", lambda *args, **kwargs: next(responses))

    results = production_smoke.run_api_checks("https://api.example.com", timeout_seconds=1, attempts=1)
    readiness = results[-1]

    assert readiness.ok is False
    assert "ai_planning" in readiness.detail
    assert "must-not-be-printed" not in readiness.detail
