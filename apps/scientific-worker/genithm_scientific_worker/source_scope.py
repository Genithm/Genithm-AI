from __future__ import annotations

"""Authorize a queued phylogeny's scientific dependency before storage reads.

This is defense in depth: DB dependency/RLS policy remains authoritative.
A service-role worker must not turn user-influenced job parameters into
arbitrary reads of private scientific objects.
"""

from collections.abc import Mapping
from typing import Any

from .input_integrity import SHA, UUID, ScientificInputIntegrityError
from .phylogeny import MAX_ALIGNMENT_BYTES


def validate_phylogeny_source(job: Mapping[str, Any]) -> tuple[str, int, str, str, int, str]:
    for field in ("organization_id", "project_id", "job_id"):
        if not isinstance(job.get(field), str) or UUID.fullmatch(job[field]) is None:
            raise ScientificInputIntegrityError("phylogeny job scope is invalid")
    fingerprint = job.get("request_fingerprint")
    if not isinstance(fingerprint, str) or SHA.fullmatch(fingerprint) is None:
        raise ScientificInputIntegrityError("phylogeny request fingerprint is invalid")

    params = job.get("parameters")
    if not isinstance(params, dict):
        raise ScientificInputIntegrityError("phylogeny parameters are invalid")

    source_job = params.get("source_msa_job_id")
    if not isinstance(source_job, str) or UUID.fullmatch(source_job) is None:
        raise ScientificInputIntegrityError("phylogeny source job ID is invalid")
    if source_job == job["job_id"]:
        raise ScientificInputIntegrityError("phylogeny cannot depend on itself")

    expected_path = (
        f"{job['organization_id']}/{job['project_id']}/{source_job}/msa-result.fasta"
    )
    path = params.get("source_result_object_path")
    if path != expected_path:
        raise ScientificInputIntegrityError("phylogeny source artifact is outside the declared tenant and MSA job")

    digest = params.get("source_result_sha256")
    if not isinstance(digest, str) or SHA.fullmatch(digest) is None:
        raise ScientificInputIntegrityError("phylogeny source artifact hash is invalid")
    byte_count = params.get("source_result_bytes")
    if type(byte_count) is not int or not 1 <= byte_count <= MAX_ALIGNMENT_BYTES:
        raise ScientificInputIntegrityError("phylogeny source artifact byte count is invalid")
    count = params.get("sequence_count")
    if type(count) is not int or not 3 <= count <= 50:
        raise ScientificInputIntegrityError("phylogeny sequence count is invalid")
    length = params.get("aligned_length")
    if type(length) is not int or not 1 <= length <= 500_000:
        raise ScientificInputIntegrityError("phylogeny aligned length is invalid")
    kind = params.get("sequence_type")
    if kind not in {"dna", "rna", "protein"}:
        raise ScientificInputIntegrityError("phylogeny source sequence type is invalid")
    model = "gtr_cat" if kind in {"dna", "rna"} else "jtt_cat"
    if params.get("model") != model:
        raise ScientificInputIntegrityError("phylogeny model does not match sequence type")
    return path, byte_count, digest, source_job, count, kind
