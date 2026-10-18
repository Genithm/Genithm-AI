"""Authenticated paired-dataset admission/status/cancellation and bounded report export."""
from __future__ import annotations

import hmac
import os
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field

from .routes import Clients, clients, operation, SAFE_CODES
from .policy import LargeDataError
from .paired_verify import result_digest, SCHEMA, VERSION

router = APIRouter(prefix="/api/v1/large-data/pairs", tags=["large-data"])
SAFE_CODES.update({"distinct_mates_required": 422, "pair_sources_unavailable": 409, "pair_capacity_exceeded": 429,
                   "pair_worker_not_ready": 503, "source_in_active_pair": 409, "pair_result_invalid": 409})
FIELDS = ("id", "project_id", "title", "read1_id", "read2_id", "read1_sha256", "read2_sha256", "read1_bytes", "read2_bytes",
          "state", "checked_read1_bytes", "checked_read2_bytes", "error_code", "result", "result_sha256", "created_at", "updated_at")


def paired_clients(c: Clients = Depends(clients)):
    if os.getenv("GENITHM_LARGE_DATA_PAIRS_ENABLED", "").lower() != "true":
        raise HTTPException(503, "paired_data_not_enabled")
    return c


class PairRequest(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")
    project_id: str
    request_id: str
    read1_id: str
    read2_id: str
    title: str = Field(min_length=3, max_length=160)


def validate_result(row):
    """Detect altered result summaries. This is not a new scientific source re-read."""
    result = row.get("result")
    if row.get("state") != "ready" or not isinstance(result, dict) or not isinstance(row.get("result_sha256"), str):
        raise LargeDataError("pair_report_not_ready", 409)
    try:
        valid = result.get("schema") == SCHEMA and result.get("verifier_version") == VERSION
        valid = valid and result.get("verification") == "whole_object_sha256_both" and result.get("sampling") is False
        for i in (1, 2):
            mate = result[f"r{i}"]
            valid = valid and (mate["upload_id"] == row[f"read{i}_id"] and mate["sha256"] == row[f"read{i}_sha256"] and
                              mate["source_bytes"] == row[f"read{i}_bytes"] and mate["metrics"]["read_count"] == result["matched_pairs"])
        valid = valid and hmac.compare_digest(result_digest(result), row["result_sha256"])
        if not valid:
            raise ValueError()
    except (KeyError, TypeError, ValueError, OverflowError):
        raise LargeDataError("pair_result_invalid", 409) from None
    return result


def public(row):
    if row["state"] == "ready":
        validate_result(row)
    return {key: row.get(key) for key in FIELDS}


@router.get("/projects/{project_id}")
def list_pairs(project_id: UUID, authorization: str | None = Header(default=None), c: Clients = Depends(paired_clients)):
    owner = c.auth(authorization)
    return operation(lambda: c.rpc("pair_list", p_owner=owner, p_project=str(project_id), p_storage=c.storage.config.identity))


@router.post("", status_code=202)
def create_pair(payload: PairRequest, authorization: str | None = Header(default=None), c: Clients = Depends(paired_clients)):
    owner = c.auth(authorization)

    def run():
        try:
            project, request, first, second = [str(UUID(x)) for x in
                                             (payload.project_id, payload.request_id, payload.read1_id, payload.read2_id)]
        except ValueError:
            raise LargeDataError("invalid_identifier", 422) from None
        if payload.title.strip() != payload.title or any(ord(x) < 32 or ord(x) == 127 for x in payload.title):
            raise LargeDataError("invalid_title", 422)
        return public(c.rpc("pair_create", p_owner=owner, p_project=project, p_request=request, p_read1=first,
                            p_read2=second, p_title=payload.title, p_storage=c.storage.config.identity))
    return operation(run)


@router.get("/{pair_id}")
def get_pair(pair_id: UUID, authorization: str | None = Header(default=None), c: Clients = Depends(paired_clients)):
    owner = c.auth(authorization)
    return operation(lambda: public(c.rpc("pair_get", p_owner=owner, p_id=str(pair_id))))


@router.post("/{pair_id}/cancel")
def cancel_pair(pair_id: UUID, authorization: str | None = Header(default=None), c: Clients = Depends(paired_clients)):
    owner = c.auth(authorization)
    return operation(lambda: public(c.rpc("pair_cancel", p_owner=owner, p_id=str(pair_id))))


def report_tsv(row):
    result = validate_result(row)
    rows = [["Genithm complete paired FASTQ QC"], ["Study title", row["title"]], ["Job ID", row["id"]],
            ["Result SHA-256", row["result_sha256"]], ["Method", VERSION],
            ["Matched ordered pairs", result["matched_pairs"]],
            ["Pairs with explicit R1/R2 annotations", result["both_mate_annotations_checked"]],
            ["Pairs checked by identifier order only", result["identifier_order_only_pairs"]],
            ["Read identifier uniqueness checked", "no"], ["Read sampling", "none"], [], ["Metric", "R1", "R2"]]
    for label, key in [("Source upload", "upload_id"), ("Source SHA-256", "sha256"), ("Source bytes", "source_bytes"), ("Format", "format")]:
        rows.append([label, result["r1"][key], result["r2"][key]])
    for key in ("read_count", "base_count", "mean_phred", "q20_bases", "q30_bases", "gc_percent", "min_length", "max_length", "mean_length"):
        rows.append([key, result["r1"]["metrics"][key], result["r2"]["metrics"][key]])
    rows.append(["Scope", "Both complete source files checked at execution. No alignment, read-name uniqueness, biological pairing proof or differential expression. Phred+33 assumed."])

    def cell(value):
        text = "undefined" if value is None else str(value)
        text = text.replace("\t", " ").replace("\r", " ").replace("\n", " ")
        return "'" + text if text.startswith(("=", "+", "-", "@")) else text
    return "\n".join("\t".join(cell(x) for x in row) for row in rows) + "\n"


@router.get("/{pair_id}/report")
def export_pair(pair_id: UUID, authorization: str | None = Header(default=None), c: Clients = Depends(paired_clients)):
    owner = c.auth(authorization)

    def run():
        row = c.rpc("pair_get", p_owner=owner, p_id=str(pair_id))
        return Response(report_tsv(row), media_type="text/tab-separated-values", headers={
            "Cache-Control": "private, no-store", "Vary": "Authorization", "X-Content-Type-Options": "nosniff",
            "Content-Disposition": f'attachment; filename="genithm-paired-qc-{pair_id}.tsv"'})
    return operation(run)
