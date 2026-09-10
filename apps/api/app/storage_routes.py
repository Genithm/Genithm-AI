from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from .settings import get_settings
from .storage import R2StorageProvider, StorageError
from .supabase_gateway import AuthenticatedUser, SupabaseGateway, SupabaseGatewayError

MAX_SEQUENCE_FILE_BYTES = 50 * 1024 * 1024
ALLOWED_EXTENSIONS = {"fa", "fasta", "fna", "faa", "fas", "txt"}
LOGICAL_SEQUENCE_BUCKET = "sequence-inputs"

router = APIRouter(prefix="/api/v1/storage", tags=["storage"])


class SequenceUploadReservation(BaseModel):
    project_id: UUID
    original_filename: str = Field(min_length=1, max_length=255)
    file_size_bytes: int = Field(ge=1, le=MAX_SEQUENCE_FILE_BYTES)
    content_type: str | None = Field(default=None, max_length=255)


class UploadReservationResponse(BaseModel):
    upload_id: UUID
    object_path: str
    upload_url: str
    method: str = "PUT"
    required_headers: dict[str, str]
    expires_seconds: int


def _safe_filename(name: str) -> str:
    value = name.strip()
    if not value or "/" in value or "\\" in value or "\x00" in value:
        raise HTTPException(status_code=422, detail="Invalid upload filename")
    if "." in value:
        extension = value.rsplit(".", 1)[1].lower()
        if extension not in ALLOWED_EXTENSIONS:
            raise HTTPException(status_code=422, detail="Unsupported FASTA/text file extension")
    return value


def _content_type(value: str | None) -> str:
    candidate = (value or "application/octet-stream").strip().lower()
    if candidate not in {"text/plain", "application/octet-stream", "application/fasta", "text/x-fasta"}:
        return "application/octet-stream"
    return candidate


def _clients() -> tuple[SupabaseGateway, R2StorageProvider, int]:
    settings = get_settings()
    if not settings.storage_gateway_configured:
        raise HTTPException(status_code=503, detail="Storage Gateway is not configured")
    assert settings.supabase_url
    assert settings.supabase_publishable_key
    assert settings.supabase_secret_key
    assert settings.r2_endpoint
    assert settings.r2_access_key_id
    assert settings.r2_secret_access_key
    gateway = SupabaseGateway(
        url=settings.supabase_url,
        publishable_key=settings.supabase_publishable_key,
        secret_key=settings.supabase_secret_key,
    )
    storage = R2StorageProvider(
        endpoint_url=settings.r2_endpoint,
        access_key_id=settings.r2_access_key_id,
        secret_access_key=settings.r2_secret_access_key,
        bucket=settings.r2_sequence_bucket,
    )
    return gateway, storage, settings.storage_signed_url_seconds


def _authenticate(gateway: SupabaseGateway, authorization: str | None) -> AuthenticatedUser:
    try:
        return gateway.authenticate(authorization)
    except SupabaseGatewayError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


def _first_row(payload: Any) -> dict[str, Any]:
    if isinstance(payload, list) and payload and isinstance(payload[0], dict):
        return payload[0]
    if isinstance(payload, dict):
        return payload
    raise HTTPException(status_code=502, detail="Storage reservation returned an invalid response")


@router.post("/sequence-uploads", response_model=UploadReservationResponse, status_code=201)
def reserve_sequence_upload(
    payload: SequenceUploadReservation,
    authorization: str | None = Header(default=None),
) -> UploadReservationResponse:
    gateway, storage, expires_seconds = _clients()
    user = _authenticate(gateway, authorization)
    filename = _safe_filename(payload.original_filename)
    content_type = _content_type(payload.content_type)
    try:
        reserved = _first_row(
            gateway.user_rpc(
                user,
                "reserve_r2_sequence_upload",
                {
                    "p_project_id": str(payload.project_id),
                    "p_original_filename": filename,
                    "p_file_size_bytes": payload.file_size_bytes,
                    "p_content_type": content_type,
                },
            )
        )
        if reserved.get("storage_provider") != "r2" or reserved.get("storage_bucket") != LOGICAL_SEQUENCE_BUCKET:
            raise HTTPException(status_code=502, detail="Storage reservation provider contract failed")
        object_path = str(reserved["object_path"])
        upload_url = storage.signed_upload(object_path, content_type=content_type, expires_seconds=expires_seconds)
        return UploadReservationResponse(
            upload_id=UUID(str(reserved["upload_id"])),
            object_path=object_path,
            upload_url=upload_url,
            required_headers={"Content-Type": content_type},
            expires_seconds=expires_seconds,
        )
    except SupabaseGatewayError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    except (StorageError, KeyError, ValueError) as exc:
        raise HTTPException(status_code=502, detail="Could not prepare secure upload") from exc


@router.post("/sequence-uploads/{upload_id}/complete")
def complete_sequence_upload(
    upload_id: UUID,
    authorization: str | None = Header(default=None),
) -> dict[str, str]:
    gateway, storage, _ = _clients()
    user = _authenticate(gateway, authorization)
    try:
        row = gateway.user_upload(user, str(upload_id))
        if row is None or row.get("created_by") != user.id:
            raise HTTPException(status_code=404, detail="Upload not found")
        if row.get("storage_provider") != "r2" or row.get("storage_bucket") != LOGICAL_SEQUENCE_BUCKET:
            raise HTTPException(status_code=409, detail="Upload is not managed by the R2 Storage Gateway")
        if row.get("status") != "pending_upload":
            return {"status": str(row.get("status"))}

        metadata = storage.metadata(str(row["object_path"]))
        expected_size = int(row["file_size_bytes"])
        if metadata.size_bytes != expected_size:
            raise HTTPException(status_code=409, detail="Uploaded object size does not match the reservation")
        expected_content_type = _content_type(row.get("content_type"))
        if metadata.content_type and metadata.content_type.lower() != expected_content_type:
            raise HTTPException(status_code=409, detail="Uploaded object content type does not match the reservation")

        result = gateway.service_rpc(
            "complete_r2_sequence_upload",
            {"upload_id": str(upload_id), "expected_user_id": user.id},
        )
        return {"status": str(result)}
    except SupabaseGatewayError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    except (StorageError, KeyError, TypeError, ValueError) as exc:
        raise HTTPException(status_code=502, detail="Could not verify uploaded object") from exc


@router.get("/sequence-uploads/{upload_id}/download-url")
def sequence_download_url(
    upload_id: UUID,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    gateway, storage, expires_seconds = _clients()
    user = _authenticate(gateway, authorization)
    try:
        row = gateway.user_upload(user, str(upload_id))
        if row is None:
            raise HTTPException(status_code=404, detail="Upload not found")
        if row.get("storage_provider") != "r2" or row.get("storage_bucket") != LOGICAL_SEQUENCE_BUCKET:
            raise HTTPException(status_code=409, detail="Legacy upload is not managed by the R2 Storage Gateway")
        if row.get("status") not in {"ready", "rejected", "error"}:
            raise HTTPException(status_code=409, detail="Upload is not available for download yet")
        url = storage.signed_download(str(row["object_path"]), expires_seconds=expires_seconds)
        return {"download_url": url, "expires_seconds": expires_seconds}
    except SupabaseGatewayError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    except (StorageError, KeyError) as exc:
        raise HTTPException(status_code=502, detail="Could not prepare secure download") from exc
