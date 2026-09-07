from __future__ import annotations

import base64
import hashlib
from dataclasses import dataclass

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey


@dataclass(frozen=True, slots=True)
class SignatureMaterial:
    public_key_base64: str
    public_key_sha256: str
    signature_base64: str


def load_private_key(raw_key_base64: str) -> Ed25519PrivateKey:
    try:
        raw = base64.b64decode(raw_key_base64, validate=True)
    except Exception as exc:
        raise ValueError("audit signing private key must be valid base64") from exc
    if len(raw) != 32:
        raise ValueError("audit signing private key must decode to exactly 32 bytes")
    return Ed25519PrivateKey.from_private_bytes(raw)


def sign_payload(private_key: Ed25519PrivateKey, payload: str) -> SignatureMaterial:
    payload_bytes = payload.encode("utf-8")
    signature = private_key.sign(payload_bytes)
    public_key = private_key.public_key().public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )
    private_key.public_key().verify(signature, payload_bytes)
    return SignatureMaterial(
        public_key_base64=base64.b64encode(public_key).decode("ascii"),
        public_key_sha256=hashlib.sha256(public_key).hexdigest(),
        signature_base64=base64.b64encode(signature).decode("ascii"),
    )


def verify_payload(*, public_key_base64: str, signature_base64: str, payload: str) -> None:
    try:
        public_key = base64.b64decode(public_key_base64, validate=True)
        signature = base64.b64decode(signature_base64, validate=True)
    except Exception as exc:
        raise ValueError("checkpoint verification material must be valid base64") from exc
    if len(public_key) != 32 or len(signature) != 64:
        raise ValueError("invalid Ed25519 checkpoint material length")
    Ed25519PublicKey.from_public_bytes(public_key).verify(signature, payload.encode("utf-8"))
