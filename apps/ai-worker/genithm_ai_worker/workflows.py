from __future__ import annotations

import hashlib
from typing import Any


def sequence_summary(input_snapshot: dict[str, Any]) -> dict[str, Any]:
    """Deterministic sequence workflow foundation.

    This first production boundary validates and summarizes sequence input.
    Domain-specific external tools can be attached behind the same handler.
    """
    sequence = input_snapshot.get("sequence")
    if not isinstance(sequence, str) or not sequence.strip():
        raise ValueError("sequence input is required")

    normalized = sequence.strip().upper()
    checksum = hashlib.sha256(normalized.encode("utf-8")).hexdigest()

    return {
        "sequence_length": len(normalized),
        "checksum": checksum,
        "sequence": normalized,
    }


def workflow_registry() -> dict[str, Any]:
    return {
        "sequence_summary": sequence_summary,
    }
