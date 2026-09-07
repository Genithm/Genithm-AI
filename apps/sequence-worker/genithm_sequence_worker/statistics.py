from __future__ import annotations

from collections import Counter
from dataclasses import dataclass

from .validator import FastaValidationError, GAP_CHARS, validate_fasta_bytes

STATISTICS_VERSION = "genithm-sequence-statistics/0.1.0"
GC_METHOD = "canonical_acgtu_only"
CANONICAL_NUCLEOTIDES = frozenset("ACGTU")


@dataclass(frozen=True, slots=True)
class SequenceStatistics:
    """Deterministic aggregate statistics for a validated FASTA input.

    Raw sequence content is intentionally not retained in this result. Composition
    frequencies use all non-gap residues as the denominator. GC percentage uses
    only canonical A/C/G/T/U residues, so ambiguous nucleotide symbols do not
    silently change the denominator.
    """

    statistics_version: str
    sequence_type: str
    sequence_count: int
    residue_count: int
    min_record_length: int
    max_record_length: int
    mean_record_length: float
    composition: dict[str, int]
    frequencies: dict[str, float]
    gap_count: int
    gc_content_percent: float | None
    gc_denominator_count: int | None
    gc_method: str | None

    def to_payload(self) -> dict[str, object]:
        return {
            "statistics_version": self.statistics_version,
            "sequence_type": self.sequence_type,
            "sequence_count": self.sequence_count,
            "residue_count": self.residue_count,
            "record_length": {
                "min": self.min_record_length,
                "max": self.max_record_length,
                "mean": self.mean_record_length,
            },
            "composition": self.composition,
            "frequencies": self.frequencies,
            "gap_count": self.gap_count,
            "gc_content_percent": self.gc_content_percent,
            "gc_denominator_count": self.gc_denominator_count,
            "gc_method": self.gc_method,
        }


def calculate_sequence_statistics(data: bytes) -> SequenceStatistics:
    """Calculate deterministic FASTA statistics after applying Genithm validation.

    The validator is the scientific gatekeeper. Statistics are only produced for
    inputs that pass the same FASTA policy used by the worker runtime.
    """

    validation = validate_fasta_bytes(data)
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError as exc:  # Defensive: validator should have caught this.
        raise FastaValidationError("FASTA input must be UTF-8 text") from exc

    composition_counter: Counter[str] = Counter()
    record_lengths: list[int] = []
    gap_count = 0
    current_length: int | None = None

    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue

        if line.startswith(">"):
            if current_length is not None:
                record_lengths.append(current_length)
            current_length = 0
            continue

        if current_length is None:
            # Defensive invariant. Validation rejects sequence data before a header.
            raise RuntimeError("statistics scan encountered sequence data before a FASTA header")

        for char in line.upper():
            if char.isspace():
                continue
            if char in GAP_CHARS:
                gap_count += 1
                continue
            composition_counter[char] += 1
            current_length += 1

    if current_length is not None:
        record_lengths.append(current_length)

    if len(record_lengths) != validation.sequence_count:
        raise RuntimeError("statistics record count disagrees with FASTA validation")
    if sum(record_lengths) != validation.residue_count:
        raise RuntimeError("statistics residue count disagrees with FASTA validation")

    composition = {symbol: composition_counter[symbol] for symbol in sorted(composition_counter)}
    frequencies = {
        symbol: round(count / validation.residue_count, 10)
        for symbol, count in composition.items()
    }

    gc_content_percent: float | None = None
    gc_denominator_count: int | None = None
    gc_method: str | None = None
    if validation.sequence_type in {"dna", "rna", "mixed"}:
        gc_denominator_count = sum(composition_counter[symbol] for symbol in CANONICAL_NUCLEOTIDES)
        if gc_denominator_count > 0:
            gc_content_percent = round(
                100.0 * (composition_counter["G"] + composition_counter["C"]) / gc_denominator_count,
                6,
            )
        gc_method = GC_METHOD

    return SequenceStatistics(
        statistics_version=STATISTICS_VERSION,
        sequence_type=validation.sequence_type,
        sequence_count=validation.sequence_count,
        residue_count=validation.residue_count,
        min_record_length=min(record_lengths),
        max_record_length=max(record_lengths),
        mean_record_length=round(validation.residue_count / validation.sequence_count, 6),
        composition=composition,
        frequencies=frequencies,
        gap_count=gap_count,
        gc_content_percent=gc_content_percent,
        gc_denominator_count=gc_denominator_count,
        gc_method=gc_method,
    )
