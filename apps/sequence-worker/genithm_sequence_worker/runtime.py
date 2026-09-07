from __future__ import annotations

import argparse
import json
import logging
import os
import time
from dataclasses import dataclass
from hashlib import sha256
from typing import Any, Protocol
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

from .statistics import calculate_sequence_statistics
from .validator import FastaValidationError, validate_fasta_bytes

LOGGER = logging.getLogger("genithm.sequence-worker")
DEFAULT_VISIBILITY_SECONDS = 300
DEFAULT_MAX_ATTEMPTS = 3
DEFAULT_POLL_SECONDS = 2.0


@dataclass(frozen=True, slots=True)
class RuntimeConfig:
    supabase_url: str
    supabase_secret_key: str
    visibility_seconds: int = DEFAULT_VISIBILITY_SECONDS
    max_attempts: int = DEFAULT_MAX_ATTEMPTS
    poll_seconds: float = DEFAULT_POLL_SECONDS

    @classmethod
    def from_env(cls) -> "RuntimeConfig":
        url = os.environ.get("SUPABASE_URL", "").strip().rstrip("/")
        key = os.environ.get("SUPABASE_SECRET_KEY", "").strip()
        if not url:
            raise RuntimeError("SUPABASE_URL is required")
        if not key:
            raise RuntimeError("SUPABASE_SECRET_KEY is required")
        if key.startswith("sb_publishable_"):
            raise RuntimeError("SUPABASE_SECRET_KEY must be a server-side secret key, not a publishable key")

        visibility = int(os.environ.get("GENITHM_SEQUENCE_VISIBILITY_SECONDS", DEFAULT_VISIBILITY_SECONDS))
        attempts = int(os.environ.get("GENITHM_SEQUENCE_MAX_ATTEMPTS", DEFAULT_MAX_ATTEMPTS))
        poll = float(os.environ.get("GENITHM_SEQUENCE_POLL_SECONDS", DEFAULT_POLL_SECONDS))
        if not 30 <= visibility <= 3600:
            raise RuntimeError("GENITHM_SEQUENCE_VISIBILITY_SECONDS must be between 30 and 3600")
        if not 1 <= attempts <= 10:
            raise RuntimeError("GENITHM_SEQUENCE_MAX_ATTEMPTS must be between 1 and 10")
        if not 0.25 <= poll <= 60:
            raise RuntimeError("GENITHM_SEQUENCE_POLL_SECONDS must be between 0.25 and 60")
        return cls(url, key, visibility, attempts, poll)


@dataclass(frozen=True, slots=True)
class ValidationJob:
    message_id: int
    read_count: int
    upload_id: str
    object_path: str
    file_size_bytes: int
    content_type: str | None


class RuntimeClient(Protocol):
    max_attempts: int

    def claim(self) -> ValidationJob | None: ...
    def download(self, job: ValidationJob) -> bytes: ...
    def finish_success(self, job: ValidationJob, result: Any, statistics: Any) -> None: ...
    def finish_rejected(self, job: ValidationJob, error: str, digest: str | None) -> None: ...
    def finish_error(self, job: ValidationJob, error: str) -> str: ...


class SupabaseRuntimeClient:
    def __init__(self, config: RuntimeConfig) -> None:
        self.config = config
        self.max_attempts = config.max_attempts

    def _headers(self, *, json_body: bool = False) -> dict[str, str]:
        headers = {
            "apikey": self.config.supabase_secret_key,
            "Authorization": f"Bearer {self.config.supabase_secret_key}",
            "User-Agent": "genithm-sequence-worker/0.1",
        }
        if json_body:
            headers["Content-Type"] = "application/json"
        return headers

    def _rpc(self, name: str, payload: dict[str, Any]) -> Any:
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        request = Request(
            f"{self.config.supabase_url}/rest/v1/rpc/{name}",
            data=body,
            headers=self._headers(json_body=True),
            method="POST",
        )
        try:
            with urlopen(request, timeout=30) as response:
                raw = response.read()
        except HTTPError as exc:
            detail = exc.read(2048).decode("utf-8", errors="replace")
            raise RuntimeError(f"Supabase RPC {name} failed with HTTP {exc.code}: {detail}") from exc
        except URLError as exc:
            raise RuntimeError(f"Supabase RPC {name} connection failed") from exc
        if not raw:
            return None
        try:
            return json.loads(raw)
        except json.JSONDecodeError as exc:
            raise RuntimeError(f"Supabase RPC {name} returned invalid JSON") from exc

    def claim(self) -> ValidationJob | None:
        rows = self._rpc("claim_sequence_validation_job", {"visibility_seconds": self.config.visibility_seconds})
        if not rows:
            return None
        row = rows[0]
        return ValidationJob(
            message_id=int(row["message_id"]),
            read_count=int(row["read_count"]),
            upload_id=str(row["upload_id"]),
            object_path=str(row["object_path"]),
            file_size_bytes=int(row["file_size_bytes"]),
            content_type=row.get("content_type"),
        )

    def download(self, job: ValidationJob) -> bytes:
        encoded_path = quote(job.object_path, safe="/")
        request = Request(
            f"{self.config.supabase_url}/storage/v1/object/authenticated/sequence-inputs/{encoded_path}",
            headers=self._headers(),
            method="GET",
        )
        try:
            with urlopen(request, timeout=60) as response:
                data = response.read(job.file_size_bytes + 1)
        except HTTPError as exc:
            raise RuntimeError(f"Private sequence download failed with HTTP {exc.code}") from exc
        except URLError as exc:
            raise RuntimeError("Private sequence download connection failed") from exc
        if len(data) != job.file_size_bytes:
            raise RuntimeError(
                f"Downloaded object size mismatch: expected {job.file_size_bytes} bytes, got {len(data)}"
            )
        return data

    def finish_success(self, job: ValidationJob, result: Any, statistics: Any) -> None:
        self._rpc(
            "finish_sequence_validation_success_v2",
            {
                "message_id": job.message_id,
                "upload_id": job.upload_id,
                "sha256": result.sha256,
                "sequence_type": result.sequence_type,
                "sequence_count": result.sequence_count,
                "residue_count": result.residue_count,
                "validator_version": result.validator_version,
                "warnings": list(result.warnings),
                "statistics_version": statistics.statistics_version,
                "statistics": statistics.to_payload(),
            },
        )

    def finish_rejected(self, job: ValidationJob, error: str, digest: str | None) -> None:
        from .validator import VALIDATOR_VERSION

        self._rpc(
            "finish_sequence_validation_rejected",
            {
                "message_id": job.message_id,
                "upload_id": job.upload_id,
                "validation_error": error[:2000],
                "validator_version": VALIDATOR_VERSION,
                "sha256": digest,
            },
        )

    def finish_error(self, job: ValidationJob, error: str) -> str:
        result = self._rpc(
            "finish_sequence_validation_error",
            {
                "message_id": job.message_id,
                "upload_id": job.upload_id,
                "processing_error": error[:2000],
                "max_attempts": self.max_attempts,
            },
        )
        return str(result)


def process_one(client: RuntimeClient) -> bool:
    job = client.claim()
    if job is None:
        return False

    LOGGER.info("claimed validation job upload_id=%s message_id=%s attempt=%s", job.upload_id, job.message_id, job.read_count)
    data: bytes | None = None
    try:
        data = client.download(job)
        result = validate_fasta_bytes(data)
        statistics = calculate_sequence_statistics(data)
        client.finish_success(job, result, statistics)
        LOGGER.info("validation ready upload_id=%s statistics_version=%s", job.upload_id, statistics.statistics_version)
    except FastaValidationError as exc:
        digest = sha256(data).hexdigest() if data is not None else None
        client.finish_rejected(job, str(exc), digest)
        LOGGER.info("validation rejected upload_id=%s", job.upload_id)
    except Exception as exc:
        state = client.finish_error(job, f"{type(exc).__name__}: {exc}")
        LOGGER.error("validation worker failure upload_id=%s state=%s error_type=%s", job.upload_id, state, type(exc).__name__)
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description="Genithm deterministic FASTA validation worker")
    parser.add_argument("--once", action="store_true", help="Process at most one queue message and exit")
    args = parser.parse_args()
    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(message)s")
    config = RuntimeConfig.from_env()
    client = SupabaseRuntimeClient(config)
    if args.once:
        process_one(client)
        return 0
    while True:
        processed = process_one(client)
        if not processed:
            time.sleep(config.poll_seconds)


if __name__ == "__main__":
    raise SystemExit(main())
