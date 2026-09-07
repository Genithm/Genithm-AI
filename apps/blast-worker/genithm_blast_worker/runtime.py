from __future__ import annotations

import argparse
import hashlib
import json
import logging
import os
import time
from dataclasses import dataclass
from typing import Any, Protocol
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

from .ncbi_blast import BlastRemoteError, BlastResultError, NcbiBlastClient, SERVICE_VERSION

LOGGER = logging.getLogger("genithm.blast-worker")
MAX_QUERY_BYTES = 2 * 1024 * 1024


@dataclass(frozen=True, slots=True)
class RuntimeConfig:
    supabase_url: str
    supabase_secret_key: str
    ncbi_tool: str
    ncbi_email: str
    visibility_seconds: int = 300
    poll_seconds: float = 2.0

    @classmethod
    def from_env(cls) -> "RuntimeConfig":
        url = os.environ.get("SUPABASE_URL", "").strip().rstrip("/")
        key = os.environ.get("SUPABASE_SECRET_KEY", "").strip()
        tool = os.environ.get("NCBI_TOOL", "genithm").strip()
        email = os.environ.get("NCBI_EMAIL", "").strip()
        visibility = int(os.environ.get("GENITHM_BLAST_VISIBILITY_SECONDS", "300"))
        poll = float(os.environ.get("GENITHM_BLAST_POLL_SECONDS", "2"))
        if not url or not key or not email:
            raise RuntimeError("SUPABASE_URL, SUPABASE_SECRET_KEY, and NCBI_EMAIL are required")
        if key.startswith("sb_publishable_"):
            raise RuntimeError("SUPABASE_SECRET_KEY must be a server-side secret key")
        if not 60 <= visibility <= 900 or not 0.25 <= poll <= 60:
            raise RuntimeError("invalid BLAST worker runtime limits")
        return cls(url, key, tool, email, visibility, poll)


@dataclass(frozen=True, slots=True)
class BlastJob:
    message_id: int
    stage: str
    job_id: str
    organization_id: str
    project_id: str
    requested_by: str
    query_upload_id: str
    query_object_path: str
    query_file_size_bytes: int
    query_sha256: str
    program: str
    database_name: str
    expect_value: str
    max_targets: int
    low_complexity_filter: bool
    remote_rid: str | None


class RuntimeClient(Protocol):
    def claim(self) -> BlastJob | None: ...
    def download_query(self, job: BlastJob) -> bytes: ...
    def finish_submission(self, job: BlastJob, rid: str, rtoe_seconds: int) -> None: ...
    def finish_pending(self, job: BlastJob) -> None: ...
    def store_result(self, job: BlastJob, data: bytes) -> str: ...
    def finish_success(self, job: BlastJob, object_path: str, result: Any) -> None: ...
    def finish_error(self, job: BlastJob, error: str, retry_poll: bool) -> str: ...


class SupabaseRuntimeClient:
    def __init__(self, config: RuntimeConfig) -> None:
        self.config = config

    def _headers(self, *, content_type: str | None = None) -> dict[str, str]:
        headers = {
            "apikey": self.config.supabase_secret_key,
            "Authorization": f"Bearer {self.config.supabase_secret_key}",
            "User-Agent": "genithm-blast-worker/0.1",
        }
        if content_type:
            headers["Content-Type"] = content_type
        return headers

    def _rpc(self, name: str, payload: dict[str, Any]) -> Any:
        request = Request(
            f"{self.config.supabase_url}/rest/v1/rpc/{name}",
            data=json.dumps(payload, separators=(",", ":")).encode("utf-8"),
            headers=self._headers(content_type="application/json"),
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
        return json.loads(raw) if raw else None

    def claim(self) -> BlastJob | None:
        rows = self._rpc("claim_blast_job", {"visibility_seconds": self.config.visibility_seconds})
        if not rows:
            return None
        row = rows[0]
        return BlastJob(
            int(row["message_id"]),
            str(row["stage"]),
            str(row["job_id"]),
            str(row["organization_id"]),
            str(row["project_id"]),
            str(row["requested_by"]),
            str(row["query_upload_id"]),
            str(row["query_object_path"]),
            int(row["query_file_size_bytes"]),
            str(row["query_sha256"]),
            str(row["program"]),
            str(row["database_name"]),
            str(row["expect_value"]),
            int(row["max_targets"]),
            bool(row["low_complexity_filter"]),
            str(row["remote_rid"]) if row.get("remote_rid") else None,
        )

    def download_query(self, job: BlastJob) -> bytes:
        if job.query_file_size_bytes > MAX_QUERY_BYTES:
            raise RuntimeError("BLAST query artifact exceeds worker limit")
        path = quote(job.query_object_path, safe="/")
        request = Request(
            f"{self.config.supabase_url}/storage/v1/object/authenticated/sequence-inputs/{path}",
            headers=self._headers(),
            method="GET",
        )
        try:
            with urlopen(request, timeout=60) as response:
                data = response.read(MAX_QUERY_BYTES + 1)
        except HTTPError as exc:
            raise RuntimeError(f"BLAST query download failed with HTTP {exc.code}") from exc
        except URLError as exc:
            raise RuntimeError("BLAST query download connection failed") from exc
        if len(data) != job.query_file_size_bytes:
            raise RuntimeError("BLAST query size mismatch")
        digest = hashlib.sha256(data).hexdigest()
        if digest != job.query_sha256:
            raise RuntimeError("BLAST query checksum mismatch")
        return data

    def finish_submission(self, job: BlastJob, rid: str, rtoe_seconds: int) -> None:
        self._rpc("finish_blast_submission", {
            "message_id": job.message_id,
            "job_id": job.job_id,
            "remote_rid": rid,
            "rtoe_seconds": rtoe_seconds,
            "service_version": SERVICE_VERSION,
        })

    def finish_pending(self, job: BlastJob) -> None:
        self._rpc("finish_blast_poll_pending", {"message_id": job.message_id, "job_id": job.job_id})

    @staticmethod
    def result_object_path(job: BlastJob) -> str:
        return f"{job.organization_id}/{job.project_id}/{job.job_id}/blast-result.xml"

    def store_result(self, job: BlastJob, data: bytes) -> str:
        path = self.result_object_path(job)
        encoded = quote(path, safe="/")
        request = Request(
            f"{self.config.supabase_url}/storage/v1/object/analysis-results/{encoded}",
            data=data,
            headers={**self._headers(content_type="application/xml"), "x-upsert": "true"},
            method="POST",
        )
        try:
            with urlopen(request, timeout=60):
                return path
        except HTTPError as exc:
            raise RuntimeError(f"BLAST result upload failed with HTTP {exc.code}") from exc
        except URLError as exc:
            raise RuntimeError("BLAST result upload connection failed") from exc

    def finish_success(self, job: BlastJob, object_path: str, result: Any) -> None:
        self._rpc("finish_blast_success", {
            "message_id": job.message_id,
            "job_id": job.job_id,
            "result_object_path": object_path,
            "raw_result_sha256": hashlib.sha256(result.raw_xml).hexdigest(),
            "raw_result_bytes": len(result.raw_xml),
            "blast_version": result.blast_version,
            "database_reported": result.database_reported,
            "database_release": result.database_release,
            "result_summary": result.summary,
            "normalized_hits": result.hits,
        })

    def finish_error(self, job: BlastJob, error: str, retry_poll: bool) -> str:
        return str(self._rpc("finish_blast_error", {
            "message_id": job.message_id,
            "job_id": job.job_id,
            "processing_error": error[:2000],
            "retry_poll": retry_poll,
            "max_poll_errors": 5,
        }))


def process_one(client: RuntimeClient, blast: NcbiBlastClient) -> bool:
    job = client.claim()
    if job is None:
        return False
    try:
        if job.stage == "submit":
            data = client.download_query(job)
            query = data.decode("ascii", errors="strict")
            submission = blast.submit(
                program=job.program,
                database=job.database_name,
                query_fasta=query,
                expect=job.expect_value,
                max_targets=job.max_targets,
                low_complexity_filter=job.low_complexity_filter,
            )
            client.finish_submission(job, submission.rid, submission.rtoe_seconds)
            LOGGER.info("BLAST submitted job_id=%s rid=%s", job.job_id, submission.rid)
            return True

        if job.stage != "poll" or not job.remote_rid:
            raise RuntimeError("invalid BLAST queue stage")

        status = blast.status(job.remote_rid)
        if status == "WAITING":
            client.finish_pending(job)
            return True
        if status in {"FAILED", "UNKNOWN"}:
            client.finish_error(job, f"NCBI BLAST remote status {status}", False)
            return True
        if status != "READY":
            raise BlastRemoteError(f"unexpected NCBI BLAST status {status}")

        result = blast.result(job.remote_rid, query_sha256=job.query_sha256, max_targets=job.max_targets)
        object_path = client.store_result(job, result.raw_xml)
        client.finish_success(job, object_path, result)
        LOGGER.info("BLAST completed job_id=%s hits=%s", job.job_id, len(result.hits))
    except (BlastRemoteError, HTTPError, URLError) as exc:
        retry_poll = job.stage == "poll" and bool(job.remote_rid)
        state = client.finish_error(job, f"{type(exc).__name__}: {exc}", retry_poll)
        LOGGER.error("BLAST transient failure job_id=%s state=%s", job.job_id, state)
    except (BlastResultError, UnicodeDecodeError, ValueError, RuntimeError) as exc:
        state = client.finish_error(job, f"{type(exc).__name__}: {exc}", False)
        LOGGER.error("BLAST terminal failure job_id=%s state=%s", job.job_id, state)
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description="Genithm controlled asynchronous BLAST worker")
    parser.add_argument("--once", action="store_true", help="Process at most one BLAST queue message and exit")
    args = parser.parse_args()
    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(message)s")
    config = RuntimeConfig.from_env()
    client = SupabaseRuntimeClient(config)
    blast = NcbiBlastClient(tool=config.ncbi_tool, email=config.ncbi_email)
    if args.once:
        process_one(client, blast)
        return 0
    while True:
        if not process_one(client, blast):
            time.sleep(config.poll_seconds)


if __name__ == "__main__":
    raise SystemExit(main())
