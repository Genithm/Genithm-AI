from __future__ import annotations

import argparse
import json
import logging
import os
import time
import uuid
from dataclasses import dataclass
from typing import Any, Protocol
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

from .ncbi import CONNECTOR_VERSION, NcbiConnector, NcbiRecord, NcbiRecordNotFound, NcbiResponseError

LOGGER = logging.getLogger("genithm.source-worker")
MAX_FASTA_BYTES = 50 * 1024 * 1024


@dataclass(frozen=True, slots=True)
class RuntimeConfig:
    supabase_url: str
    supabase_secret_key: str
    ncbi_tool: str
    ncbi_email: str
    ncbi_api_key: str | None = None
    visibility_seconds: int = 300
    max_attempts: int = 3
    poll_seconds: float = 2.0

    @classmethod
    def from_env(cls) -> "RuntimeConfig":
        url = os.environ.get("SUPABASE_URL", "").strip().rstrip("/")
        key = os.environ.get("SUPABASE_SECRET_KEY", "").strip()
        tool = os.environ.get("NCBI_TOOL", "genithm").strip()
        email = os.environ.get("NCBI_EMAIL", "").strip()
        api_key = os.environ.get("NCBI_API_KEY", "").strip() or None
        if not url or not key or not email:
            raise RuntimeError("SUPABASE_URL, SUPABASE_SECRET_KEY, and NCBI_EMAIL are required")
        if key.startswith("sb_publishable_"):
            raise RuntimeError("SUPABASE_SECRET_KEY must be a server-side secret key")
        visibility = int(os.environ.get("GENITHM_NCBI_VISIBILITY_SECONDS", "300"))
        attempts = int(os.environ.get("GENITHM_NCBI_MAX_ATTEMPTS", "3"))
        poll = float(os.environ.get("GENITHM_NCBI_POLL_SECONDS", "2"))
        if not 60 <= visibility <= 1800 or not 1 <= attempts <= 10 or not 0.25 <= poll <= 60:
            raise RuntimeError("invalid NCBI worker runtime limits")
        return cls(url, key, tool, email, api_key, visibility, attempts, poll)


@dataclass(frozen=True, slots=True)
class RetrievalJob:
    message_id: int
    read_count: int
    retrieval_id: str
    organization_id: str
    project_id: str
    requested_by: str
    database_name: str
    requested_accession: str


class RuntimeClient(Protocol):
    max_attempts: int
    def claim(self) -> RetrievalJob | None: ...
    def store(self, job: RetrievalJob, upload_id: str, record: NcbiRecord, fasta: bytes) -> None: ...
    def finish_success(self, job: RetrievalJob, upload_id: str, record: NcbiRecord, fasta_size: int) -> None: ...
    def finish_not_found(self, job: RetrievalJob) -> None: ...
    def finish_rejected(self, job: RetrievalJob, reason: str) -> None: ...
    def finish_error(self, job: RetrievalJob, error: str) -> str: ...


class SupabaseRuntimeClient:
    def __init__(self, config: RuntimeConfig) -> None:
        self.config = config
        self.max_attempts = config.max_attempts

    def _headers(self, *, content_type: str | None = None) -> dict[str, str]:
        headers = {"apikey": self.config.supabase_secret_key, "Authorization": f"Bearer {self.config.supabase_secret_key}", "User-Agent": "genithm-source-worker/0.1"}
        if content_type:
            headers["Content-Type"] = content_type
        return headers

    def _rpc(self, name: str, payload: dict[str, Any]) -> Any:
        request = Request(f"{self.config.supabase_url}/rest/v1/rpc/{name}", data=json.dumps(payload, separators=(",", ":")).encode(), headers=self._headers(content_type="application/json"), method="POST")
        try:
            with urlopen(request, timeout=30) as response:
                raw = response.read()
        except HTTPError as exc:
            detail = exc.read(2048).decode("utf-8", errors="replace")
            raise RuntimeError(f"Supabase RPC {name} failed with HTTP {exc.code}: {detail}") from exc
        except URLError as exc:
            raise RuntimeError(f"Supabase RPC {name} connection failed") from exc
        return json.loads(raw) if raw else None

    def claim(self) -> RetrievalJob | None:
        rows = self._rpc("claim_ncbi_sequence_retrieval_job", {"visibility_seconds": self.config.visibility_seconds})
        if not rows:
            return None
        row = rows[0]
        return RetrievalJob(int(row["message_id"]), int(row["read_count"]), str(row["retrieval_id"]), str(row["organization_id"]), str(row["project_id"]), str(row["requested_by"]), str(row["database_name"]), str(row["requested_accession"]))

    @staticmethod
    def object_path(job: RetrievalJob, upload_id: str, record: NcbiRecord) -> str:
        filename = f"ncbi-{record.accession_version.lower()}.fasta"
        return f"{job.organization_id}/{job.project_id}/{job.requested_by}/{upload_id}/{filename}"

    def store(self, job: RetrievalJob, upload_id: str, record: NcbiRecord, fasta: bytes) -> None:
        path = quote(self.object_path(job, upload_id, record), safe="/")
        request = Request(f"{self.config.supabase_url}/storage/v1/object/sequence-inputs/{path}", data=fasta, headers={**self._headers(content_type="text/plain"), "x-upsert": "false"}, method="POST")
        try:
            with urlopen(request, timeout=60):
                return
        except HTTPError as exc:
            if exc.code in {400, 409}:
                return
            raise RuntimeError(f"Supabase Storage upload failed with HTTP {exc.code}") from exc
        except URLError as exc:
            raise RuntimeError("Supabase Storage upload connection failed") from exc

    def finish_success(self, job: RetrievalJob, upload_id: str, record: NcbiRecord, fasta_size: int) -> None:
        self._rpc("finish_ncbi_sequence_retrieval_success", {"message_id": job.message_id, "retrieval_id": job.retrieval_id, "sequence_upload_id": upload_id, "resolved_accession": record.accession_version, "file_size_bytes": fasta_size, "record_title": record.title, "organism": record.organism, "reported_length": record.length, "record_updated_date": record.updated_date, "connector_version": CONNECTOR_VERSION})

    def finish_not_found(self, job: RetrievalJob) -> None:
        self._rpc("finish_ncbi_sequence_retrieval_not_found", {"message_id": job.message_id, "retrieval_id": job.retrieval_id, "connector_version": CONNECTOR_VERSION})

    def finish_rejected(self, job: RetrievalJob, reason: str) -> None:
        self._rpc("finish_ncbi_sequence_retrieval_rejected", {"message_id": job.message_id, "retrieval_id": job.retrieval_id, "reason": reason[:2000], "connector_version": CONNECTOR_VERSION})

    def finish_error(self, job: RetrievalJob, error: str) -> str:
        return str(self._rpc("finish_ncbi_sequence_retrieval_error", {"message_id": job.message_id, "retrieval_id": job.retrieval_id, "processing_error": error[:2000], "max_attempts": self.max_attempts}))


def deterministic_upload_id(retrieval_id: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"genithm:ncbi:{retrieval_id}"))


def process_one(client: RuntimeClient, connector: NcbiConnector) -> bool:
    job = client.claim()
    if job is None:
        return False
    try:
        record = connector.fetch(job.database_name, job.requested_accession)
        fasta = record.fasta_bytes()
        if not 1 <= len(fasta) <= MAX_FASTA_BYTES:
            client.finish_rejected(job, "NCBI FASTA is outside the 50 MiB Genithm ingestion limit")
            return True
        upload_id = deterministic_upload_id(job.retrieval_id)
        client.store(job, upload_id, record, fasta)
        client.finish_success(job, upload_id, record, len(fasta))
        LOGGER.info("NCBI retrieval completed retrieval_id=%s accession=%s", job.retrieval_id, record.accession_version)
    except NcbiRecordNotFound:
        client.finish_not_found(job)
    except NcbiResponseError as exc:
        client.finish_rejected(job, str(exc))
    except Exception as exc:
        state = client.finish_error(job, f"{type(exc).__name__}: {exc}")
        LOGGER.error("NCBI retrieval failed retrieval_id=%s state=%s error_type=%s", job.retrieval_id, state, type(exc).__name__)
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description="Genithm controlled external scientific source worker")
    parser.add_argument("--once", action="store_true", help="Process at most one NCBI retrieval and exit")
    args = parser.parse_args()
    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(message)s")
    config = RuntimeConfig.from_env()
    client = SupabaseRuntimeClient(config)
    connector = NcbiConnector(tool=config.ncbi_tool, email=config.ncbi_email, api_key=config.ncbi_api_key)
    if args.once:
        process_one(client, connector)
        return 0
    while True:
        if not process_one(client, connector):
            time.sleep(config.poll_seconds)


if __name__ == "__main__":
    raise SystemExit(main())
