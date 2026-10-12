from __future__ import annotations

"""Fail-closed provenance checks for *production* queued scientific inputs.

Checks supplement (never replace) object SHA-256 verification in Client.download.
No database schema or job API changes are required.
"""

import re
from collections.abc import Mapping, Sequence
from typing import Any

DNA = frozenset("ACGTN")
RNA = frozenset("ACGUN")
# Supports standard residues and common accepted ambiguity/unknown symbols.
PROTEIN = frozenset("ACDEFGHIKLMNPQRSTVWYBXZJUO*")
ALPHABETS = {"dna": DNA, "rna": RNA, "protein": PROTEIN}
SHA = re.compile(r"[a-f0-9]{64}\Z")
UUID = re.compile(r"[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\Z", re.I)


class ScientificInputIntegrityError(ValueError):
    pass


def validate_input_manifest(
    job: Mapping[str, Any], *, count_min: int, count_max: int,
    allowed_types: frozenset[str], roles: tuple[str, ...] | None = None,
) -> list[dict[str, Any]]:
    """Validate queue claim metadata before downloading any artifact."""
    entries = job.get("inputs")
    if not isinstance(entries, list) or not count_min <= len(entries) <= count_max:
        raise ScientificInputIntegrityError("scientific input manifest contains an invalid number of records")
    for field in ("organization_id", "project_id", "job_id"):
        if not isinstance(job.get(field), str) or not UUID.fullmatch(job[field]):
            raise ScientificInputIntegrityError("scientific job scope is invalid")
    if not isinstance(job.get("request_fingerprint"), str) or not SHA.fullmatch(job["request_fingerprint"]):
        raise ScientificInputIntegrityError("scientific request fingerprint is invalid")

    checked: list[dict[str, Any]] = []
    for index, item in enumerate(entries, start=1):
        if not isinstance(item, dict):
            raise ScientificInputIntegrityError("scientific input provenance must be an object")
        position = item.get("position")
        if isinstance(position, bool) or not isinstance(position, int) or position != index:
            raise ScientificInputIntegrityError("scientific input positions are not canonical")
        if roles is not None and item.get("role") != roles[index - 1]:
            raise ScientificInputIntegrityError("scientific input roles are not canonical")
        kind = item.get("sequence_type")
        if not isinstance(kind, str) or kind not in allowed_types:
            raise ScientificInputIntegrityError("scientific input type is incompatible with the requested tool")
        if not isinstance(item.get("sha256"), str) or not SHA.fullmatch(item["sha256"]):
            raise ScientificInputIntegrityError("scientific input SHA-256 provenance is invalid")
        count = item.get("residue_count")
        if isinstance(count, bool) or not isinstance(count, int) or count < 1 or count > 100_000:
            raise ScientificInputIntegrityError("scientific input residue count is invalid")
        size = item.get("file_size_bytes")
        if isinstance(size, bool) or not isinstance(size, int) or not 1 <= size <= 2 * 1024 * 1024:
            raise ScientificInputIntegrityError("scientific input declared byte count is invalid")
        path = item.get("object_path")
        if not isinstance(path, str) or not 1 <= len(path) <= 1024 or "\x00" in path or ".." in path.split("/"):
            raise ScientificInputIntegrityError("scientific input storage path is invalid")
        checked.append(item)
    return checked


def validate_sequence_content(item: Mapping[str, Any], sequence: str, *, tool: str) -> None:
    """Bind downloaded FASTA content to the DB-validated type and residue count."""
    if not isinstance(sequence, str) or len(sequence) != item.get("residue_count"):
        raise ScientificInputIntegrityError("parsed residues do not match validated sequence length")
    kind = item.get("sequence_type")
    alphabet = ALPHABETS.get(kind)
    if alphabet is None or not frozenset(sequence) <= alphabet:
        raise ScientificInputIntegrityError(f"{tool} FASTA contains residues outside validated {kind} alphabet")


def validate_shared_sequence_type(inputs: Sequence[Mapping[str, Any]]) -> str:
    kinds = {item.get("sequence_type") for item in inputs}
    if len(kinds) != 1:
        raise ScientificInputIntegrityError("scientific alignment mixes incompatible sequence types")
    return next(iter(kinds))
