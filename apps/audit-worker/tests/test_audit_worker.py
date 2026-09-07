from __future__ import annotations

import base64
import hashlib

import pytest
from cryptography.exceptions import InvalidSignature

from genithm_audit_worker.runtime import Settings, process_once
from genithm_audit_worker.signing import load_private_key, sign_payload, verify_payload

PRIVATE_KEY_BASE64 = base64.b64encode(bytes(range(32))).decode("ascii")
PAYLOAD = "genithm-audit-checkpoint-v1\norganization_id=11111111-1111-1111-1111-111111111111\nchain_sequence=25\nchain_head_hash=" + ("a" * 64) + "\n"


def settings() -> Settings:
    return Settings(
        supabase_url="https://example.supabase.co",
        supabase_secret_key="sb_secret_test_server_only_key_1234567890",
        signing_key_id="audit-ed25519-test-v1",
        signing_private_key_base64=PRIVATE_KEY_BASE64,
    )


def test_sign_and_verify_payload() -> None:
    key = load_private_key(PRIVATE_KEY_BASE64)
    material = sign_payload(key, PAYLOAD)
    assert len(base64.b64decode(material.public_key_base64)) == 32
    assert len(base64.b64decode(material.signature_base64)) == 64
    assert len(material.public_key_sha256) == 64
    verify_payload(
        public_key_base64=material.public_key_base64,
        signature_base64=material.signature_base64,
        payload=PAYLOAD,
    )
    with pytest.raises(InvalidSignature):
        verify_payload(
            public_key_base64=material.public_key_base64,
            signature_base64=material.signature_base64,
            payload=PAYLOAD + "tampered",
        )


def test_rejects_invalid_private_key_length() -> None:
    with pytest.raises(ValueError, match="32 bytes"):
        load_private_key(base64.b64encode(b"short").decode("ascii"))


class FakeClient:
    def __init__(self, payload_hash: str | None = None) -> None:
        self.calls: list[tuple[str, dict[str, object]]] = []
        self.payload_hash = payload_hash or hashlib.sha256(PAYLOAD.encode()).hexdigest()

    def rpc(self, name: str, payload: dict[str, object]) -> object:
        self.calls.append((name, payload))
        if name == "claim_audit_checkpoint_job":
            return [{
                "message_id": 7,
                "checkpoint_request_id": "22222222-2222-2222-2222-222222222222",
                "organization_id": "11111111-1111-1111-1111-111111111111",
                "chain_sequence": 25,
                "chain_head_hash": "a" * 64,
                "signing_payload": PAYLOAD,
                "payload_sha256": self.payload_hash,
            }]
        if name == "finish_audit_checkpoint_success":
            return "22222222-2222-2222-2222-222222222222"
        if name == "finish_audit_checkpoint_error":
            return "retry"
        raise AssertionError(name)


def test_process_once_signs_and_finalizes() -> None:
    client = FakeClient()
    assert process_once(settings(), client) is True
    names = [name for name, _ in client.calls]
    assert names == ["claim_audit_checkpoint_job", "finish_audit_checkpoint_success"]
    success = client.calls[-1][1]
    assert success["signing_key_id"] == "audit-ed25519-test-v1"
    assert len(base64.b64decode(str(success["public_key_base64"]))) == 32
    assert len(base64.b64decode(str(success["signature_base64"]))) == 64


def test_process_once_rejects_payload_hash_mismatch_and_records_error() -> None:
    client = FakeClient(payload_hash="0" * 64)
    with pytest.raises(ValueError, match="SHA-256 mismatch"):
        process_once(settings(), client)
    assert [name for name, _ in client.calls] == [
        "claim_audit_checkpoint_job",
        "finish_audit_checkpoint_error",
    ]


def test_process_once_no_job_is_idle() -> None:
    class EmptyClient:
        def rpc(self, name: str, payload: dict[str, object]) -> object:
            return []

    assert process_once(settings(), EmptyClient()) is False
