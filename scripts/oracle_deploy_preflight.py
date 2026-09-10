from __future__ import annotations

import argparse
import re
import shutil
import subprocess
from pathlib import Path

IMAGE_RE = re.compile(r"^ghcr\.io/[a-z0-9._/-]+@sha256:[0-9a-f]{64}$", re.IGNORECASE)
PLACEHOLDER_TOKENS = ("REPLACE_ME", "REPLACE_WITH_", "example.com", "<", ">")

API_REQUIRED = {
    "GENITHM_API_IMAGE",
    "GENITHM_API_ALLOWED_ORIGINS",
    "SUPABASE_URL",
    "SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_SECRET_KEY",
    "GENITHM_R2_ENDPOINT",
    "GENITHM_R2_ACCESS_KEY_ID",
    "GENITHM_R2_SECRET_ACCESS_KEY",
    "GENITHM_R2_SEQUENCE_BUCKET",
}

WORKER_REQUIRED = {
    "SUPABASE_URL",
    "SUPABASE_SECRET_KEY",
    "NCBI_EMAIL",
    "GENITHM_R2_ENDPOINT",
    "GENITHM_R2_ACCESS_KEY_ID",
    "GENITHM_R2_SECRET_ACCESS_KEY",
    "GENITHM_R2_SEQUENCE_BUCKET",
    "GENITHM_AI_PRIMARY_API_KEY",
    "GENITHM_AI_PRIMARY_ENDPOINT",
    "GENITHM_AI_PRIMARY_MODEL",
    "GENITHM_AI_BACKUP_API_KEY",
    "GENITHM_AI_BACKUP_ENDPOINT",
    "GENITHM_AI_BACKUP_MODEL",
    "GENITHM_AUDIT_SIGNING_KEY_ID",
    "GENITHM_AUDIT_SIGNING_PRIVATE_KEY_BASE64",
    "GENITHM_SEQUENCE_WORKER_IMAGE",
    "GENITHM_SOURCE_WORKER_IMAGE",
    "GENITHM_BLAST_WORKER_IMAGE",
    "GENITHM_SCIENTIFIC_WORKER_IMAGE",
    "GENITHM_AUDIT_WORKER_IMAGE",
    "GENITHM_AI_WORKER_IMAGE",
}


def load_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def validate_env(values: dict[str, str], required: set[str], *, image_keys: set[str]) -> list[str]:
    errors: list[str] = []
    for key in sorted(required):
        value = values.get(key, "").strip()
        if not value:
            errors.append(f"missing required value: {key}")
            continue
        if any(token in value for token in PLACEHOLDER_TOKENS):
            errors.append(f"placeholder value remains: {key}")

    for key in sorted(image_keys):
        value = values.get(key, "")
        if value and not IMAGE_RE.fullmatch(value):
            errors.append(f"image must be GHCR digest-pinned: {key}")

    for key in ("SUPABASE_URL", "GENITHM_R2_ENDPOINT", "GENITHM_API_ALLOWED_ORIGINS", "GENITHM_AI_PRIMARY_ENDPOINT", "GENITHM_AI_BACKUP_ENDPOINT"):
        value = values.get(key)
        if value and not value.startswith("https://"):
            errors.append(f"HTTPS required: {key}")

    return errors


def compose_check(env_file: Path, compose_file: Path) -> list[str]:
    if shutil.which("docker") is None:
        return ["docker executable not found"]
    proc = subprocess.run(
        ["docker", "compose", "--env-file", str(env_file), "-f", str(compose_file), "config", "--quiet"],
        capture_output=True,
        text=True,
        check=False,
    )
    if proc.returncode == 0:
        return []
    detail = (proc.stderr or proc.stdout).strip()
    return [f"docker compose config failed: {detail}"]


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate Genithm Oracle production deployment inputs before starting containers.")
    parser.add_argument("role", choices=("api", "workers"))
    parser.add_argument("--env-file", type=Path)
    parser.add_argument("--compose", action="store_true", help="Also run docker compose config --quiet.")
    args = parser.parse_args()

    repo = Path(__file__).resolve().parents[1]
    if args.role == "api":
        env_file = args.env_file or repo / "deploy/oracle/.env.api"
        compose_file = repo / "deploy/oracle/docker-compose.api.yml"
        required = API_REQUIRED
        image_keys = {"GENITHM_API_IMAGE"}
    else:
        env_file = args.env_file or repo / "deploy/oracle/.env.workers"
        compose_file = repo / "deploy/oracle/docker-compose.workers.yml"
        required = WORKER_REQUIRED
        image_keys = {key for key in WORKER_REQUIRED if key.endswith("_IMAGE")}

    if not env_file.is_file():
        print(f"FAIL: env file not found: {env_file}")
        return 2

    values = load_env(env_file)
    errors = validate_env(values, required, image_keys=image_keys)
    if args.compose:
        errors.extend(compose_check(env_file, compose_file))

    if errors:
        for error in errors:
            print(f"FAIL: {error}")
        return 1

    print(f"PASS: {args.role} deployment preflight")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
