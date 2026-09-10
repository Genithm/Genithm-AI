from __future__ import annotations

import argparse
import os

import pytest

from scripts import production_e2e


def test_clean_https_origin_accepts_plain_https_origin() -> None:
    assert production_e2e._clean_https_origin("https://api.example.com/", "API URL") == "https://api.example.com"


@pytest.mark.parametrize(
    "value",
    [
        "http://api.example.com",
        "https://user:pass@api.example.com",
        "https://api.example.com?token=x",
        "https://api.example.com#fragment",
    ],
)
def test_clean_https_origin_rejects_unsafe_targets(value: str) -> None:
    with pytest.raises(production_e2e.E2EError):
        production_e2e._clean_https_origin(value, "API URL")


def test_config_requires_runtime_credentials(monkeypatch: pytest.MonkeyPatch) -> None:
    for key in (
        "GENITHM_E2E_SUPABASE_URL",
        "GENITHM_E2E_SUPABASE_PUBLISHABLE_KEY",
        "GENITHM_E2E_API_BASE_URL",
        "GENITHM_E2E_EMAIL",
        "GENITHM_E2E_PASSWORD",
    ):
        monkeypatch.delenv(key, raising=False)

    args = argparse.Namespace(timeout_seconds=10.0, poll_seconds=2.0, max_wait_seconds=180.0)
    with pytest.raises(production_e2e.E2EError, match="missing required runtime environment"):
        production_e2e._config_from_env(args)


def test_config_loads_only_runtime_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    values = {
        "GENITHM_E2E_SUPABASE_URL": "https://project.supabase.co",
        "GENITHM_E2E_SUPABASE_PUBLISHABLE_KEY": "publishable-placeholder",
        "GENITHM_E2E_API_BASE_URL": "https://api.example.com",
        "GENITHM_E2E_EMAIL": "release-test@example.invalid",
        "GENITHM_E2E_PASSWORD": "runtime-only-placeholder",
    }
    for key, value in values.items():
        monkeypatch.setenv(key, value)

    args = argparse.Namespace(timeout_seconds=7.0, poll_seconds=1.0, max_wait_seconds=120.0)
    config = production_e2e._config_from_env(args)

    assert config.supabase_url == values["GENITHM_E2E_SUPABASE_URL"]
    assert config.api_base_url == values["GENITHM_E2E_API_BASE_URL"]
    assert config.publishable_key == values["GENITHM_E2E_SUPABASE_PUBLISHABLE_KEY"]
    assert config.email == values["GENITHM_E2E_EMAIL"]
    assert config.password == values["GENITHM_E2E_PASSWORD"]
    assert config.timeout_seconds == 7.0
    assert config.poll_seconds == 1.0
    assert config.max_wait_seconds == 120.0


def test_auth_headers_use_publishable_key_and_user_token() -> None:
    config = production_e2e.Config(
        supabase_url="https://project.supabase.co",
        publishable_key="public-key",
        api_base_url="https://api.example.com",
        email="release-test@example.invalid",
        password="not-a-real-password",
        timeout_seconds=5.0,
        poll_seconds=1.0,
        max_wait_seconds=30.0,
    )
    assert production_e2e._auth_headers(config, "user-access-token") == {
        "apikey": "public-key",
        "Authorization": "Bearer user-access-token",
    }
