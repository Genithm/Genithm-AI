from __future__ import annotations

from scripts.oracle_deploy_preflight import API_REQUIRED, WORKER_REQUIRED, validate_env


def _valid_base() -> dict[str, str]:
    return {
        "SUPABASE_URL": "https://project.supabase.co",
        "SUPABASE_PUBLISHABLE_KEY": "sb_publishable_valid",
        "SUPABASE_SECRET_KEY": "sb_secret_valid",
        "GENITHM_R2_ENDPOINT": "https://acct.r2.cloudflarestorage.com",
        "GENITHM_R2_ACCESS_KEY_ID": "access",
        "GENITHM_R2_SECRET_ACCESS_KEY": "secret",
        "GENITHM_R2_SEQUENCE_BUCKET": "genithm-sequence-inputs",
        "GENITHM_API_ALLOWED_ORIGINS": "https://app.genithm.com",
        "GENITHM_AI_PRIMARY_API_KEY": "primary",
        "GENITHM_AI_PRIMARY_ENDPOINT": "https://primary.example.net",
        "GENITHM_AI_PRIMARY_MODEL": "model-a",
        "GENITHM_AI_BACKUP_API_KEY": "backup",
        "GENITHM_AI_BACKUP_ENDPOINT": "https://backup.example.net",
        "GENITHM_AI_BACKUP_MODEL": "model-b",
        "GENITHM_AUDIT_SIGNING_KEY_ID": "audit-key-1",
        "GENITHM_AUDIT_SIGNING_PRIVATE_KEY_BASE64": "ZmFrZQ==",
        "NCBI_EMAIL": "ops@genithm.invalid",
    }


def test_api_contract_accepts_digest_pinned_images_and_tunnel_token() -> None:
    values = _valid_base()
    values["GENITHM_API_IMAGE"] = "ghcr.io/genithm/genithm-api@sha256:" + "a" * 64
    values["GENITHM_CLOUDFLARED_IMAGE"] = "cloudflare/cloudflared@sha256:" + "b" * 64
    values["GENITHM_CLOUDFLARE_TUNNEL_TOKEN"] = "opaque-runtime-token"
    assert validate_env(
        values,
        API_REQUIRED,
        image_keys={"GENITHM_API_IMAGE", "GENITHM_CLOUDFLARED_IMAGE"},
    ) == []


def test_worker_contract_accepts_six_digest_pinned_images() -> None:
    values = _valid_base()
    image_keys = {key for key in WORKER_REQUIRED if key.endswith("_IMAGE")}
    for index, key in enumerate(sorted(image_keys)):
        values[key] = f"ghcr.io/genithm/{key.lower()}@sha256:" + str(index + 1) * 64
    assert validate_env(values, WORKER_REQUIRED, image_keys=image_keys) == []


def test_rejects_tagged_or_placeholder_images() -> None:
    values = _valid_base()
    values["GENITHM_API_IMAGE"] = "ghcr.io/genithm/genithm-api:latest"
    errors = validate_env(values, API_REQUIRED, image_keys={"GENITHM_API_IMAGE", "GENITHM_CLOUDFLARED_IMAGE"})
    assert "image must be OCI digest-pinned: GENITHM_API_IMAGE" in errors

    values["GENITHM_API_IMAGE"] = "ghcr.io/genithm/genithm-api@sha256:REPLACE_WITH_64_HEX_DIGEST"
    errors = validate_env(values, API_REQUIRED, image_keys={"GENITHM_API_IMAGE", "GENITHM_CLOUDFLARED_IMAGE"})
    assert "placeholder value remains: GENITHM_API_IMAGE" in errors


def test_requires_cloudflare_tunnel_inputs() -> None:
    values = _valid_base()
    values["GENITHM_API_IMAGE"] = "ghcr.io/genithm/genithm-api@sha256:" + "a" * 64
    errors = validate_env(values, API_REQUIRED, image_keys={"GENITHM_API_IMAGE", "GENITHM_CLOUDFLARED_IMAGE"})
    assert "missing required value: GENITHM_CLOUDFLARED_IMAGE" in errors
    assert "missing required value: GENITHM_CLOUDFLARE_TUNNEL_TOKEN" in errors


def test_requires_https_for_external_endpoints() -> None:
    values = _valid_base()
    values["GENITHM_API_IMAGE"] = "ghcr.io/genithm/genithm-api@sha256:" + "a" * 64
    values["GENITHM_CLOUDFLARED_IMAGE"] = "cloudflare/cloudflared@sha256:" + "b" * 64
    values["GENITHM_CLOUDFLARE_TUNNEL_TOKEN"] = "opaque-runtime-token"
    values["GENITHM_R2_ENDPOINT"] = "http://r2.invalid"
    errors = validate_env(values, API_REQUIRED, image_keys={"GENITHM_API_IMAGE", "GENITHM_CLOUDFLARED_IMAGE"})
    assert "HTTPS required: GENITHM_R2_ENDPOINT" in errors
