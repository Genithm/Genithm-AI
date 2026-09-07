from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import time
from dataclasses import dataclass
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .signing import load_private_key, sign_payload


@dataclass(frozen=True, slots=True)
class Settings:
    supabase_url: str
    supabase_secret_key: str
    signing_key_id: str
    signing_private_key_base64: str
    visibility_seconds: int = 300
    poll_seconds: float = 2.0

    @classmethod
    def from_env(cls) -> "Settings":
        url = os.environ.get("SUPABASE_URL", "").strip().rstrip("/")
        secret = os.environ.get("SUPABASE_SECRET_KEY", "").strip()
        key_id = os.environ.get("GENITHM_AUDIT_SIGNING_KEY_ID", "").strip()
        private_key = os.environ.get("GENITHM_AUDIT_SIGNING_PRIVATE_KEY_BASE64", "").strip()
        if not url.startswith("https://"):
            raise ValueError("SUPABASE_URL must be an https URL")
        if not secret or secret.startswith("sb_publishable_"):
            raise ValueError("SUPABASE_SECRET_KEY must be a server-side secret key")
        if len(key_id) < 3 or len(key_id) > 128 or any(ch not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._:-" for ch in key_id):
            raise ValueError("GENITHM_AUDIT_SIGNING_KEY_ID is invalid")
        if not private_key:
            raise ValueError("GENITHM_AUDIT_SIGNING_PRIVATE_KEY_BASE64 is required")
        visibility = int(os.environ.get("GENITHM_AUDIT_VISIBILITY_SECONDS", "300"))
        poll = float(os.environ.get("GENITHM_AUDIT_POLL_SECONDS", "2"))
        if visibility < 60 or visibility > 900:
            raise ValueError("GENITHM_AUDIT_VISIBILITY_SECONDS must be 60..900")
        if poll < 0.25 or poll > 60:
            raise ValueError("GENITHM_AUDIT_POLL_SECONDS must be 0.25..60")
        return cls(url, secret, key_id, private_key, visibility, poll)


class SupabaseRpcClient:
    def __init__(self, *, url: str, secret_key: str, timeout: float = 30.0) -> None:
        self.url = url.rstrip("/")
        self.secret_key = secret_key
        self.timeout = timeout

    def rpc(self, name: str, payload: dict[str, object]) -> object:
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        request = Request(
            f"{self.url}/rest/v1/rpc/{name}",
            data=body,
            method="POST",
            headers={
                "apikey": self.secret_key,
                "Authorization": f"Bearer {self.secret_key}",
                "Content-Type": "application/json",
                "Accept": "application/json",
                "User-Agent": "genithm-audit-worker/0.1.0",
            },
        )
        try:
            with urlopen(request, timeout=self.timeout) as response:
                data = response.read(1024 * 1024)
        except HTTPError as exc:
            detail = exc.read(8192).decode("utf-8", "replace")
            raise RuntimeError(f"Supabase RPC {name} failed with HTTP {exc.code}: {detail[:1000]}") from exc
        except URLError as exc:
            raise RuntimeError(f"Supabase RPC {name} connection failed") from exc
        if not data:
            return None
        return json.loads(data)


def _first_row(value: object) -> dict[str, object] | None:
    if value is None:
        return None
    if isinstance(value, list):
        if not value:
            return None
        value = value[0]
    if not isinstance(value, dict):
        raise RuntimeError("Supabase claim response has an unexpected shape")
    return value


def process_once(settings: Settings, client: SupabaseRpcClient) -> bool:
    private_key = load_private_key(settings.signing_private_key_base64)
    claimed = _first_row(client.rpc("claim_audit_checkpoint_job", {"visibility_seconds": settings.visibility_seconds}))
    if claimed is None:
        return False

    message_id = int(claimed["message_id"])
    request_id = str(claimed["checkpoint_request_id"])
    payload = str(claimed["signing_payload"])
    expected_hash = str(claimed["payload_sha256"])

    try:
        actual_hash = hashlib.sha256(payload.encode("utf-8")).hexdigest()
        if actual_hash != expected_hash:
            raise ValueError("checkpoint payload SHA-256 mismatch")

        material = sign_payload(private_key, payload)
        client.rpc(
            "finish_audit_checkpoint_success",
            {
                "message_id": message_id,
                "checkpoint_request_id": request_id,
                "signing_key_id": settings.signing_key_id,
                "public_key_base64": material.public_key_base64,
                "signature_base64": material.signature_base64,
            },
        )
        return True
    except Exception as exc:
        try:
            client.rpc(
                "finish_audit_checkpoint_error",
                {
                    "message_id": message_id,
                    "checkpoint_request_id": request_id,
                    "processing_error": str(exc)[:1500],
                    "max_attempts": 5,
                },
            )
        except Exception as finish_exc:
            raise RuntimeError("checkpoint processing failed and error finalization also failed") from finish_exc
        raise


def run_forever(settings: Settings) -> None:
    client = SupabaseRpcClient(url=settings.supabase_url, secret_key=settings.supabase_secret_key)
    while True:
        try:
            worked = process_once(settings, client)
        except Exception as exc:
            print(f"audit worker iteration failed: {exc}", file=sys.stderr, flush=True)
            worked = True
        if not worked:
            time.sleep(settings.poll_seconds)


def main() -> None:
    parser = argparse.ArgumentParser(description="Sign Genithm audit-chain checkpoints with an external Ed25519 key")
    parser.add_argument("--once", action="store_true", help="Process at most one queued checkpoint and exit")
    args = parser.parse_args()
    settings = Settings.from_env()
    client = SupabaseRpcClient(url=settings.supabase_url, secret_key=settings.supabase_secret_key)
    if args.once:
        process_once(settings, client)
        return
    run_forever(settings)


if __name__ == "__main__":
    main()
