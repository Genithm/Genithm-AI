import pytest
from fastapi import HTTPException

from app.storage_routes import _content_type, _safe_filename
from app.supabase_gateway import SupabaseGateway, SupabaseGatewayError


def test_storage_gateway_accepts_fasta_filename_and_normalizes_content_type():
    assert _safe_filename("sample.fasta") == "sample.fasta"
    assert _content_type("text/plain") == "text/plain"
    assert _content_type("application/unknown") == "application/octet-stream"


def test_storage_gateway_rejects_path_like_filename():
    with pytest.raises(HTTPException) as exc:
        _safe_filename("../sample.fasta")
    assert exc.value.status_code == 422


def test_storage_gateway_rejects_unsupported_extension():
    with pytest.raises(HTTPException) as exc:
        _safe_filename("sample.exe")
    assert exc.value.status_code == 422


def test_supabase_gateway_requires_bearer_authentication():
    with pytest.raises(SupabaseGatewayError) as exc:
        SupabaseGateway.bearer_token("Basic abc")
    assert exc.value.status_code == 401


def test_supabase_gateway_extracts_bearer_token():
    assert SupabaseGateway.bearer_token("Bearer user-token") == "user-token"
