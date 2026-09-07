from __future__ import annotations

import argparse
import hashlib
import json
import logging
import os
import time
from dataclasses import dataclass
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

from .pairwise import EXECUTOR_VERSION, TOOL_ID, TOOL_VERSION, PairwiseAlignmentError, align, parse_single_fasta

LOGGER = logging.getLogger("genithm.scientific-worker")
MAX_INPUT_BYTES = 2 * 1024 * 1024
MAX_RESULT_BYTES = 25 * 1024 * 1024


@dataclass(frozen=True, slots=True)
class Config:
    supabase_url: str
    supabase_secret_key: str
    visibility_seconds: int = 300
    max_attempts: int = 3
    poll_seconds: float = 2.0

    @classmethod
    def from_env(cls) -> "Config":
        url = os.environ.get("SUPABASE_URL", "").strip().rstrip("/")
        key = os.environ.get("SUPABASE_SECRET_KEY", "").strip()
        if not url or not key:
            raise RuntimeError("SUPABASE_URL and SUPABASE_SECRET_KEY are required")
        if key.startswith("sb_publishable_"):
            raise RuntimeError("SUPABASE_SECRET_KEY must be a server-side secret key")
        visibility = int(os.environ.get("GENITHM_SCIENTIFIC_VISIBILITY_SECONDS", "300"))
        attempts = int(os.environ.get("GENITHM_SCIENTIFIC_MAX_ATTEMPTS", "3"))
        poll = float(os.environ.get("GENITHM_SCIENTIFIC_POLL_SECONDS", "2"))
        if not 60 <= visibility <= 900 or not 1 <= attempts <= 10 or not 0.25 <= poll <= 60:
            raise RuntimeError("invalid scientific worker runtime limits")
        return cls(url, key, visibility, attempts, poll)


class Client:
    def __init__(self, config: Config) -> None:
        self.config = config

    def _headers(self, content_type: str | None = None) -> dict[str, str]:
        headers = {
            "apikey": self.config.supabase_secret_key,
            "Authorization": f"Bearer {self.config.supabase_secret_key}",
            "User-Agent": EXECUTOR_VERSION,
        }
        if content_type:
            headers["Content-Type"] = content_type
        return headers

    def rpc(self, name: str, payload: dict[str, Any]) -> Any:
        request = Request(
            f"{self.config.supabase_url}/rest/v1/rpc/{name}",
            data=json.dumps(payload, separators=(",", ":")).encode(),
            headers=self._headers("application/json"),
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

    def download(self, path: str, expected_size: int, expected_sha256: str) -> bytes:
        if expected_size < 1 or expected_size > MAX_INPUT_BYTES:
            raise PairwiseAlignmentError("scientific input file exceeds worker read limit")
        encoded = quote(path, safe="/")
        request = Request(
            f"{self.config.supabase_url}/storage/v1/object/authenticated/sequence-inputs/{encoded}",
            headers=self._headers(),
            method="GET",
        )
        try:
            with urlopen(request, timeout=30) as response:
                data = response.read(MAX_INPUT_BYTES + 1)
        except HTTPError as exc:
            raise RuntimeError(f"input download failed with HTTP {exc.code}") from exc
        except URLError as exc:
            raise RuntimeError("input download connection failed") from exc
        if len(data) != expected_size or hashlib.sha256(data).hexdigest() != expected_sha256:
            raise PairwiseAlignmentError("scientific input integrity check failed")
        return data

    def _existing_result_matches(self, path: str, expected: bytes) -> bool:
        encoded = quote(path, safe="/")
        request = Request(
            f"{self.config.supabase_url}/storage/v1/object/authenticated/analysis-results/{encoded}",
            headers=self._headers(),
            method="GET",
        )
        try:
            with urlopen(request, timeout=30) as response:
                existing = response.read(MAX_RESULT_BYTES + 1)
        except HTTPError as exc:
            if exc.code == 404:
                return False
            raise RuntimeError(f"scientific result object check failed with HTTP {exc.code}") from exc
        except URLError as exc:
            raise RuntimeError("scientific result object check connection failed") from exc
        return len(existing) == len(expected) and hashlib.sha256(existing).digest() == hashlib.sha256(expected).digest()

    def upload_result(self, path: str, data: bytes) -> None:
        if not data or len(data) > MAX_RESULT_BYTES:
            raise PairwiseAlignmentError("scientific result artifact exceeds allowed size")
        encoded = quote(path, safe="/")
        request = Request(
            f"{self.config.supabase_url}/storage/v1/object/analysis-results/{encoded}",
            data=data,
            headers={**self._headers("application/json"), "x-upsert": "false"},
            method="POST",
        )
        try:
            with urlopen(request, timeout=30):
                return
        except HTTPError as exc:
            if exc.code in {400, 409}:
                if self._existing_result_matches(path, data):
                    return
                raise PairwiseAlignmentError("existing scientific result artifact does not match deterministic output") from exc
            raise RuntimeError(f"scientific result upload failed with HTTP {exc.code}") from exc
        except URLError as exc:
            raise RuntimeError("scientific result upload connection failed") from exc


def canonical_result(job: dict[str, Any], sequence_a: str, sequence_b: str) -> tuple[bytes, dict[str, Any], dict[str, Any]]:
    params = job["parameters"]
    result = align(
        sequence_a,
        sequence_b,
        algorithm=str(params["algorithm"]),
        match_score=int(params["match_score"]),
        mismatch_score=int(params["mismatch_score"]),
        gap_score=int(params["gap_score"]),
    )
    inputs = job["inputs"]
    summary = {
        "job_type": "pairwise_alignment",
        "algorithm": result.algorithm,
        "score": result.score,
        "aligned_length": result.aligned_length,
        "matches": result.matches,
        "mismatches": result.mismatches,
        "gaps": result.gaps,
        "identity_percent": result.identity_percent,
        "input_a_sha256": str(inputs[0]["sha256"]),
        "input_b_sha256": str(inputs[1]["sha256"]),
    }
    provenance = {
        "tool_id": TOOL_ID,
        "tool_version": TOOL_VERSION,
        "executor_version": EXECUTOR_VERSION,
        "request_fingerprint": str(job["request_fingerprint"]),
        "parameters": params,
        "inputs": [
            {"position": int(item["position"]), "role": str(item["role"]), "sha256": str(item["sha256"])}
            for item in inputs
        ],
    }
    artifact = {
        "schema_version": "genithm-pairwise-result/1",
        "summary": summary,
        "alignment": {"sequence_a": result.aligned_a, "sequence_b": result.aligned_b},
        "provenance": provenance,
    }
    data = json.dumps(artifact, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("utf-8")
    return data, summary, provenance


def process_one(client: Client) -> bool:
    rows = client.rpc("claim_scientific_job", {"visibility_seconds": client.config.visibility_seconds})
    if not rows:
        return False
    job = rows[0]
    message_id = int(job["message_id"])
    job_id = str(job["job_id"])
    try:
        if job["job_type"] != "pairwise_alignment" or job["tool_id"] != TOOL_ID or job["tool_version"] != TOOL_VERSION:
            raise PairwiseAlignmentError("claimed scientific job does not match approved pairwise executor")
        inputs = job["inputs"]
        if not isinstance(inputs, list) or len(inputs) != 2:
            raise PairwiseAlignmentError("scientific job inputs are invalid")
        raw_a = client.download(str(inputs[0]["object_path"]), int(inputs[0]["file_size_bytes"]), str(inputs[0]["sha256"]))
        raw_b = client.download(str(inputs[1]["object_path"]), int(inputs[1]["file_size_bytes"]), str(inputs[1]["sha256"]))
        sequence_a = parse_single_fasta(raw_a)
        sequence_b = parse_single_fasta(raw_b)
        data, summary, provenance = canonical_result(job, sequence_a, sequence_b)
        path = f"{job['organization_id']}/{job['project_id']}/{job_id}/pairwise-result.json"
        client.upload_result(path, data)
        client.rpc("finish_scientific_job_success", {
            "message_id": message_id,
            "job_id": job_id,
            "executor_version": EXECUTOR_VERSION,
            "result_object_path": path,
            "result_sha256": hashlib.sha256(data).hexdigest(),
            "result_bytes": len(data),
            "result_summary": summary,
            "provenance": provenance,
        })
        LOGGER.info("scientific job completed job_id=%s type=pairwise_alignment", job_id)
    except PairwiseAlignmentError as exc:
        client.rpc("finish_scientific_job_error", {
            "message_id": message_id, "job_id": job_id, "failure_class": "input_integrity",
            "processing_error": str(exc)[:2000], "retryable": False, "max_attempts": client.config.max_attempts,
        })
    except Exception as exc:
        client.rpc("finish_scientific_job_error", {
            "message_id": message_id, "job_id": job_id, "failure_class": "infrastructure",
            "processing_error": f"{type(exc).__name__}: scientific worker failed"[:2000],
            "retryable": True, "max_attempts": client.config.max_attempts,
        })
        LOGGER.error("scientific job failed job_id=%s error_type=%s", job_id, type(exc).__name__)
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description="Genithm isolated scientific execution worker")
    parser.add_argument("--once", action="store_true", help="Process at most one scientific job and exit")
    args = parser.parse_args()
    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(message)s")
    config = Config.from_env()
    client = Client(config)
    if args.once:
        process_one(client)
        return 0
    while True:
        if not process_one(client):
            time.sleep(config.poll_seconds)


if __name__ == "__main__":
    raise SystemExit(main())
