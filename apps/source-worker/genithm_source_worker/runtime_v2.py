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

from .ncbi import NcbiConnector
from .protein_annotation import (
    CONNECTOR_VERSION as ANNOTATION_CONNECTOR_VERSION,
    AnnotationEvidence,
    ProteinAnnotationConnector,
    ProteinAnnotationError,
    ProteinAnnotationTransientError,
    parse_single_protein_fasta,
)
from .runtime import RuntimeConfig, SupabaseRuntimeClient, process_one as process_ncbi_one

LOGGER = logging.getLogger("genithm.source-worker")
WORKER_VERSION = "genithm-source-worker/0.3.0"
MAX_INPUT_BYTES = 2 * 1024 * 1024


@dataclass(frozen=True, slots=True)
class AnnotationJob:
    message_id: int
    job_id: str
    organization_id: str
    project_id: str
    requested_by: str
    sequence_upload_id: str
    refseq_accession: str
    input_object_path: str
    input_file_size_bytes: int
    input_sha256: str
    input_residue_count: int


class AnnotationRuntimeClient:
    def __init__(self, base: SupabaseRuntimeClient) -> None:
        self.base = base
        self.max_attempts = base.max_attempts

    def claim(self) -> AnnotationJob | None:
        rows = self.base._rpc("claim_protein_annotation_job", {"visibility_seconds": self.base.config.visibility_seconds})
        if not rows:
            return None
        row = rows[0]
        return AnnotationJob(
            message_id=int(row["message_id"]),
            job_id=str(row["job_id"]),
            organization_id=str(row["organization_id"]),
            project_id=str(row["project_id"]),
            requested_by=str(row["requested_by"]),
            sequence_upload_id=str(row["sequence_upload_id"]),
            refseq_accession=str(row["refseq_accession"]),
            input_object_path=str(row["input_object_path"]),
            input_file_size_bytes=int(row["input_file_size_bytes"]),
            input_sha256=str(row["input_sha256"]),
            input_residue_count=int(row["input_residue_count"]),
        )

    def download_input(self, job: AnnotationJob) -> bytes:
        if job.input_file_size_bytes < 1 or job.input_file_size_bytes > MAX_INPUT_BYTES:
            raise ProteinAnnotationError("protein annotation input exceeds worker read limit")
        if len(job.input_sha256) != 64:
            raise ProteinAnnotationError("protein annotation input SHA-256 metadata is invalid")
        encoded = quote(job.input_object_path, safe="/")
        request = Request(
            f"{self.base.config.supabase_url}/storage/v1/object/authenticated/sequence-inputs/{encoded}",
            headers=self.base._headers(),
            method="GET",
        )
        try:
            with urlopen(request, timeout=30) as response:
                raw = response.read(MAX_INPUT_BYTES + 1)
        except HTTPError as exc:
            raise RuntimeError(f"protein annotation input download failed with HTTP {exc.code}") from exc
        except URLError as exc:
            raise RuntimeError("protein annotation input download connection failed") from exc
        if len(raw) != job.input_file_size_bytes or hashlib.sha256(raw).hexdigest() != job.input_sha256:
            raise ProteinAnnotationError("protein annotation input integrity check failed")
        return raw

    def finish_no_mapping(self, job: AnnotationJob, mapping_sha256: str, mapping_bytes: int) -> None:
        self.base._rpc("finish_protein_annotation_no_mapping", {
            "message_id": job.message_id,
            "job_id": job.job_id,
            "connector_version": ANNOTATION_CONNECTOR_VERSION,
            "mapping_response_sha256": mapping_sha256,
            "mapping_response_bytes": mapping_bytes,
        })

    def finish_success(self, job: AnnotationJob, evidence: AnnotationEvidence) -> None:
        summary = {
            "input_sha256": job.input_sha256,
            "refseq_accession": job.refseq_accession,
            "uniprot_accession": evidence.uniprot.accession,
            "uniprot_reviewed": evidence.uniprot.reviewed,
            "interpro_entry_count": len(evidence.interpro_entries),
            "pfam_entry_count": len(evidence.pfam_entries),
            "freshness_policy": "live_source_no_cache",
        }
        self.base._rpc("finish_protein_annotation_success", {
            "message_id": job.message_id,
            "job_id": job.job_id,
            "connector_version": ANNOTATION_CONNECTOR_VERSION,
            "mapping_candidate_count": evidence.mapping_candidate_count,
            "mapping_response_sha256": evidence.mapping_payload.sha256,
            "mapping_response_bytes": evidence.mapping_payload.byte_count,
            "uniprot_accession": evidence.uniprot.accession,
            "uniprot_entry_id": evidence.uniprot.entry_id,
            "uniprot_reviewed": evidence.uniprot.reviewed,
            "uniprot_release": evidence.uniprot.release or "",
            "uniprot_release_date": evidence.uniprot.release_date or "",
            "uniprot_sequence_sha256": evidence.uniprot.sequence_sha256,
            "uniprot_response_sha256": evidence.uniprot.payload.sha256,
            "uniprot_response_bytes": evidence.uniprot.payload.byte_count,
            "protein_name": evidence.uniprot.protein_name or "",
            "gene_names": evidence.uniprot.gene_names,
            "organism_name": evidence.uniprot.organism_name or "",
            "interpro_entries": evidence.interpro_entries,
            "interpro_response_sha256": evidence.interpro_payload.sha256,
            "interpro_response_bytes": evidence.interpro_payload.byte_count,
            "pfam_entries": evidence.pfam_entries,
            "pfam_response_sha256": evidence.pfam_payload.sha256,
            "pfam_response_bytes": evidence.pfam_payload.byte_count,
            "annotation_summary": summary,
        })

    def finish_error(self, job: AnnotationJob, error: str, retryable: bool) -> str:
        return str(self.base._rpc("finish_protein_annotation_error", {
            "message_id": job.message_id,
            "job_id": job.job_id,
            "processing_error": error[:2000],
            "retryable": retryable,
            "max_attempts": self.max_attempts,
        }))


def process_annotation_one(client: AnnotationRuntimeClient, connector: ProteinAnnotationConnector) -> bool:
    job = client.claim()
    if job is None:
        return False
    try:
        raw = client.download_input(job)
        sequence = parse_single_protein_fasta(raw)
        if len(sequence) != job.input_residue_count:
            raise ProteinAnnotationError("protein annotation input residue count does not match immutable metadata")
        evidence = connector.annotate(job.refseq_accession, sequence)
        if evidence is None:
            candidates, mapping_payload = connector.map_refseq_to_uniprot(job.refseq_accession)
            if candidates:
                raise ProteinAnnotationError("UniProt mapping state changed during annotation request")
            client.finish_no_mapping(job, mapping_payload.sha256, mapping_payload.byte_count)
            LOGGER.info("protein annotation no mapping job_id=%s refseq=%s", job.job_id, job.refseq_accession)
            return True
        client.finish_success(job, evidence)
        LOGGER.info("protein annotation completed job_id=%s refseq=%s uniprot=%s", job.job_id, job.refseq_accession, evidence.uniprot.accession)
    except ProteinAnnotationTransientError as exc:
        state = client.finish_error(job, str(exc), True)
        LOGGER.warning("protein annotation transient failure job_id=%s state=%s", job.job_id, state)
    except ProteinAnnotationError as exc:
        client.finish_error(job, str(exc), False)
        LOGGER.warning("protein annotation rejected job_id=%s reason=%s", job.job_id, str(exc)[:300])
    except Exception as exc:
        state = client.finish_error(job, f"{type(exc).__name__}: protein annotation worker failed", True)
        LOGGER.error("protein annotation failed job_id=%s state=%s error_type=%s", job.job_id, state, type(exc).__name__)
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description="Genithm controlled external scientific source worker")
    parser.add_argument("--once", action="store_true", help="Process at most one source or annotation job and exit")
    args = parser.parse_args()
    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(message)s")
    config = RuntimeConfig.from_env()
    base = SupabaseRuntimeClient(config)
    ncbi = NcbiConnector(tool=config.ncbi_tool, email=config.ncbi_email, api_key=config.ncbi_api_key)
    annotation_client = AnnotationRuntimeClient(base)
    annotation = ProteinAnnotationConnector(user_agent=f"{WORKER_VERSION} {ANNOTATION_CONNECTOR_VERSION}")
    if args.once:
        if not process_annotation_one(annotation_client, annotation):
            process_ncbi_one(base, ncbi)
        return 0
    while True:
        worked = process_annotation_one(annotation_client, annotation)
        worked = process_ncbi_one(base, ncbi) or worked
        if not worked:
            time.sleep(config.poll_seconds)


if __name__ == "__main__":
    raise SystemExit(main())
