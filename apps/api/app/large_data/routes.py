from __future__ import annotations

import logging
from functools import lru_cache
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, StrictInt
from typing import Literal

from ..settings import get_settings
from ..supabase_gateway import SupabaseGateway, SupabaseGatewayError
from .policy import LargeDataConfig, LargeDataError, MAX_BYTES, PART_BYTES, URL_TTL, part_size
from .storage import MultipartStorage

log = logging.getLogger("genithm.large-data")
router = APIRouter(prefix="/api/v1/large-data", tags=["large-data"])
SAFE_CODES = {"not_found":404,"quota_not_configured":409,"quota_exceeded":409,"file_size_limit":413,
 "too_many_active_uploads":429,"verifier_not_ready":503,"idempotency_conflict":409,
 "operation_in_progress":409,"upload_links_still_active":409,"lease_lost":409,"invalid_part":422}
PUBLIC_FIELDS = ("id","project_id","original_filename","expected_bytes","expected_sha256","data_format","state",
                 "part_bytes","checked_bytes","actual_sha256","summary","error_code","created_at","updated_at")


class Reserve(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    # JSON UUID strings are parsed by FastAPI; keep string IDs strict and validate explicitly.
    project_id: str
    request_id: str
    filename: str = Field(min_length=1, max_length=255)
    expected_bytes: StrictInt = Field(ge=1, le=MAX_BYTES)
    expected_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    data_format: Literal["fastq", "fastq.gz", "opaque"]


class Clients:
    def __init__(self, gateway, storage):
        self.gateway, self.storage = gateway, storage

    def auth(self, authorization):
        try:
            user = self.gateway.authenticate(authorization)
            UUID(user.id)
            return user.id
        except (SupabaseGatewayError, ValueError):
            raise HTTPException(401, "authentication_required") from None

    def rpc(self, name, **params):
        try:
            return self.gateway.service_rpc("large_data_" + name, params)
        except SupabaseGatewayError as exc:
            # Never return the upstream response: it may include private paths or SQL context.
            for code, status in SAFE_CODES.items():
                if code in str(exc):
                    raise LargeDataError(code, status) from None
            raise LargeDataError("large_data_database_unavailable", 503) from None


@lru_cache
def clients():
    try:
        config = LargeDataConfig.from_env()
        settings = get_settings()
        if not all((settings.supabase_url, settings.supabase_publishable_key, settings.supabase_secret_key)):
            raise LargeDataError("large_data_auth_not_configured", 503)
        return Clients(SupabaseGateway(url=settings.supabase_url,
            publishable_key=settings.supabase_publishable_key, secret_key=settings.supabase_secret_key),
            MultipartStorage(config))
    except LargeDataError as exc:
        raise HTTPException(exc.status, exc.code) from None


def public(row):
    return {k: row.get(k) for k in PUBLIC_FIELDS}


def operation(fn):
    # Run sync I/O in FastAPI's threadpool (all endpoint functions are def, not async).
    try:
        return fn()
    except HTTPException:
        raise
    except LargeDataError as exc:
        raise HTTPException(exc.status, exc.code) from None
    except Exception as exc:
        log.warning("large-data operation failed: type=%s", type(exc).__name__)
        raise HTTPException(502, "large_data_operation_uncertain_retry_status_first") from None


@router.get("/projects/{project_id}")
def overview(project_id: UUID, authorization: str | None = Header(default=None), c: Clients = Depends(clients)):
    owner = c.auth(authorization)
    return operation(lambda: {"limits": c.rpc("limits", p_owner=owner,p_project=str(project_id),p_storage=c.storage.config.identity),
        "uploads": c.rpc("list",p_owner=owner,p_project=str(project_id)), "part_bytes":PART_BYTES,
        "formats":["fastq","fastq.gz","opaque"]})


@router.post("/uploads", status_code=201)
def reserve(payload: Reserve, authorization: str | None = Header(default=None), c: Clients = Depends(clients)):
    owner = c.auth(authorization)
    def run():
        try:
            project, request = str(UUID(payload.project_id)), str(UUID(payload.request_id))
        except ValueError:
            raise LargeDataError("invalid_identifier", 422) from None
        if payload.filename.strip() != payload.filename or any(ord(x)<32 for x in payload.filename) or any(x in payload.filename for x in ("/","\\")):
            raise LargeDataError("invalid_filename", 422)
        row = c.rpc("reserve",p_owner=owner,p_project=project,p_request=request,p_filename=payload.filename,
                    p_bytes=payload.expected_bytes,p_sha256=payload.expected_sha256,p_format=payload.data_format,
                    p_storage=c.storage.config.identity)
        if row["state"] != "reserved":
            return public(row)
        row = c.rpc("acquire",p_owner=owner,p_id=row["id"],p_operation="initialize")
        provider_id = c.storage.create(row)
        return public(c.rpc("finish_operation",p_id=row["id"],p_token=row["operation_token"],
                             p_operation="initialize",p_provider_id=provider_id))
    return operation(run)


@router.get("/uploads/{upload_id}")
def status(upload_id: UUID, authorization: str | None = Header(default=None), c: Clients = Depends(clients)):
    owner = c.auth(authorization)
    def run():
        row = c.rpc("get",p_owner=owner,p_id=str(upload_id))
        result = public(row)
        result["parts"] = c.storage.parts(row) if row["state"] == "uploading" else []
        # Provider receipts are size/ordering checks only, NOT source verification.
        return result
    return operation(run)


@router.post("/uploads/{upload_id}/parts/{number}")
def sign(upload_id: UUID, number: int, authorization: str | None = Header(default=None), c: Clients = Depends(clients)):
    owner = c.auth(authorization)
    def run():
        row = c.rpc("sign_part",p_owner=owner,p_id=str(upload_id),p_number=number)
        return {"url":c.storage.sign(row,number),"method":"PUT","expires_seconds":URL_TTL,
                "bytes":part_size(row["expected_bytes"],number,row["part_bytes"]),"headers":{}}
    return operation(run)


@router.post("/uploads/{upload_id}/complete")
def complete(upload_id: UUID, authorization: str | None = Header(default=None), c: Clients = Depends(clients)):
    owner = c.auth(authorization)
    def run():
        row = c.rpc("get",p_owner=owner,p_id=str(upload_id),p_write=True)
        if row["state"] in ("uploaded","verifying","ready","rejected","verification_error"):
            return public(row)
        # Validate completeness before locking finalization: a missing part is recoverable.
        if row["state"] == "uploading":
            c.storage.validate_parts(row, c.storage.parts(row))
        row = c.rpc("acquire",p_owner=owner,p_id=row["id"],p_operation="complete")
        info = c.storage.head(row)
        if info is None:
            parts = c.storage.parts(row)
            c.storage.complete(row,parts)
            info = c.storage.head(row)
        if info is None:
            raise LargeDataError("object_completion_unconfirmed", 502)
        return public(c.rpc("finish_operation",p_id=row["id"],p_token=row["operation_token"],
                             p_operation="complete",p_etag=info["etag"]))
    return operation(run)


@router.post("/uploads/{upload_id}/abort")
def abort(upload_id: UUID, authorization: str | None = Header(default=None), c: Clients = Depends(clients)):
    owner = c.auth(authorization)
    def run():
        row = c.rpc("acquire",p_owner=owner,p_id=str(upload_id),p_operation="abort")
        if row["state"] == "aborted":
            return public(row)
        c.storage.cleanup(row)
        return public(c.rpc("finish_operation",p_id=row["id"],p_token=row["operation_token"],p_operation="abort"))
    return operation(run)


class LargeDataBodyLimit:
    """Control-plane JSON only. Never let a GB file become an API request body."""
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http" and scope.get("path", "").startswith("/api/v1/large-data") and scope.get("method") == "POST":
            from starlette.responses import JSONResponse
            headers = dict(scope.get("headers", []))
            raw = headers.get(b"content-length", b"")
            if not raw.isdigit() or b"transfer-encoding" in headers:
                await JSONResponse({"detail":"bounded_content_length_required"},411)(scope,receive,send)
                return
            if int(raw) > 16384:
                await JSONResponse({"detail":"large_data_control_request_too_large"},413)(scope,receive,send)
                return
        await self.app(scope,receive,send)
