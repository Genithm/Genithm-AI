"""Small authenticated control messages only; no FASTQ bytes enter HTTP routes."""
from __future__ import annotations

import os
from uuid import UUID
from typing import Literal
from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from .routes import Clients, clients, operation
from .quality_report import brief_summary, report_response

router = APIRouter(prefix="/api/v1/large-data", tags=["large-data-pairs"])
FIELDS = ("id", "project_id", "title", "r1_id", "r2_id", "state", "expected_bytes", "checked_bytes",
    "checked_pairs", "summary", "error_code", "created_at", "updated_at", "sources_available")


def enabled():
    if os.getenv("GENITHM_LARGE_DATA_PAIRING_ENABLED", "").lower() != "true":
        raise HTTPException(503, "pairing_not_enabled")


def public(row):
    result = {key: row.get(key) for key in FIELDS}
    result["summary"] = brief_summary(row.get("summary"))
    return result


class PairRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    project_id: UUID
    request_id: UUID
    r1_id: UUID
    r2_id: UUID
    title: str = Field(min_length=3, max_length=160, strict=True)


@router.get("/projects/{project_id}/pairs", dependencies=[Depends(enabled)])
def overview(project_id: UUID, authorization: str | None = Header(default=None), c: Clients = Depends(clients)):
    owner = c.auth(authorization)
    def run():
        result = c.rpc("pair_overview", p_owner=owner, p_project=str(project_id), p_storage=c.storage.config.identity)
        return {"worker_ready": result["worker_ready"], "pairs": [public(p) for p in result["pairs"]]}
    return operation(run)


@router.post("/pairs", status_code=201, dependencies=[Depends(enabled)])
def create(payload: PairRequest, authorization: str | None = Header(default=None), c: Clients = Depends(clients)):
    owner = c.auth(authorization)
    if payload.title != payload.title.strip() or any(ord(x) < 32 or ord(x) == 127 for x in payload.title):
        raise HTTPException(422, "invalid_pair_title")
    return operation(lambda: public(c.rpc("pair_enqueue", p_owner=owner, p_project=str(payload.project_id),
        p_request=str(payload.request_id), p_title=payload.title, p_r1=str(payload.r1_id), p_r2=str(payload.r2_id),
        p_storage=c.storage.config.identity)))


@router.get("/pairs/{pair_id}", dependencies=[Depends(enabled)])
def status(pair_id: UUID, authorization: str | None = Header(default=None), c: Clients = Depends(clients)):
    owner = c.auth(authorization)
    return operation(lambda: public(c.rpc("pair_get", p_owner=owner, p_id=str(pair_id))))


@router.post("/pairs/{pair_id}/cancel", dependencies=[Depends(enabled)])
def cancel(pair_id: UUID, authorization: str | None = Header(default=None), c: Clients = Depends(clients)):
    owner = c.auth(authorization)
    return operation(lambda: public(c.rpc("pair_cancel", p_owner=owner, p_id=str(pair_id))))


@router.get("/pairs/{pair_id}/quality-report", dependencies=[Depends(enabled)])
def quality_report(pair_id: UUID, format: Literal["json", "tsv"] = "json",
                   authorization: str | None = Header(default=None), c: Clients = Depends(clients)):
    owner = c.auth(authorization)
    return operation(lambda: report_response(c.rpc("pair_get", p_owner=owner, p_id=str(pair_id)), format, paired=True))
