from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256

VALIDATOR_VERSION = "genithm-fasta-validator/0.1.0"
MAX_FILE_BYTES = 50 * 1024 * 1024
MAX_HEADER_CHARS = 1000
MAX_RECORDS = 100_000

DNA = frozenset("ACGTRYSWKMBDHVN")
RNA = frozenset("ACGURYSWKMBDHVN")
NUCLEIC = DNA | RNA
PROTEIN = frozenset("ACDEFGHIKLMNPQRSTVWYBXZJUO*")
IGNORED_SEQUENCE_CHARS = frozenset(" \t")
GAP_CHARS = frozenset("-.")


class FastaValidationError(ValueError):
    """Raised when an input is not a valid FASTA document under Genithm's policy."""


@dataclass(frozen=True, slots=True)
class ValidationResult:
    sha256: str
    sequence_type: str
    sequence_count: int
    residue_count: int
    warnings: tuple[str, ...]
    validator_version: str = VALIDATOR_VERSION


def _decode(data: bytes) -> str:
    if not data:
        raise FastaValidationError("FASTA input is empty")
    if len(data) > MAX_FILE_BYTES:
        raise FastaValidationError("FASTA input exceeds the 50 MiB limit")
    if b"\x00" in data:
        raise FastaValidationError("Binary NUL bytes are not valid FASTA input")
    try:
        return data.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise FastaValidationError("FASTA input must be UTF-8 text") from exc


def _classify(residues: set[str]) -> str:
    biological = residues - GAP_CHARS
    if not biological:
        raise FastaValidationError("FASTA contains no biological residues")

    invalid = biological - (NUCLEIC | PROTEIN)
    if invalid:
        sample = "".join(sorted(invalid))[:12]
        raise FastaValidationError(f"Unsupported residue characters: {sample}")

    if biological <= NUCLEIC:
        has_t = "T" in biological
        has_u = "U" in biological
        if has_t and has_u:
            return "mixed"
        if has_u:
            return "rna"
        return "dna"

    if biological <= PROTEIN:
        return "protein"

    return "mixed"


def validate_fasta_bytes(data: bytes) -> ValidationResult:
    """Validate FASTA bytes without returning or persisting sequence content."""
    text = _decode(data)
    warnings: list[str] = []
    sequence_count = 0
    residue_count = 0
    seen_headers: set[str] = set()
    all_residues: set[str] = set()
    current_has_residue = False
    saw_header = False
    stripped_internal_whitespace = False

    for line_number, raw_line in enumerate(text.splitlines(), start=1):
        line = raw_line.strip()
        if not line:
            continue

        if line.startswith(">"):
            if saw_header and not current_has_residue:
                raise FastaValidationError(f"Record before line {line_number} has no sequence")
            header = line[1:].strip()
            if not header:
                raise FastaValidationError(f"Header on line {line_number} is empty")
            if len(header) > MAX_HEADER_CHARS:
                raise FastaValidationError(f"Header on line {line_number} exceeds {MAX_HEADER_CHARS} characters")
            sequence_count += 1
            if sequence_count > MAX_RECORDS:
                raise FastaValidationError(f"FASTA exceeds the {MAX_RECORDS} record limit")
            if header in seen_headers and "duplicate_headers" not in warnings:
                warnings.append("duplicate_headers")
            seen_headers.add(header)
            saw_header = True
            current_has_residue = False
            continue

        if not saw_header:
            raise FastaValidationError(f"Sequence data appears before the first FASTA header on line {line_number}")

        chars: list[str] = []
        for char in line.upper():
            if char in IGNORED_SEQUENCE_CHARS:
                stripped_internal_whitespace = True
                continue
            if char.isspace():
                stripped_internal_whitespace = True
                continue
            chars.append(char)

        if not chars:
            continue

        residues = set(chars)
        invalid = residues - (NUCLEIC | PROTEIN | GAP_CHARS)
        if invalid:
            sample = "".join(sorted(invalid))[:12]
            raise FastaValidationError(f"Unsupported residue characters on line {line_number}: {sample}")

        non_gap_count = sum(char not in GAP_CHARS for char in chars)
        if non_gap_count:
            current_has_residue = True
            residue_count += non_gap_count
        all_residues.update(residues)

    if not saw_header:
        raise FastaValidationError("FASTA contains no records")
    if not current_has_residue:
        raise FastaValidationError("Final FASTA record has no sequence")
    if residue_count == 0:
        raise FastaValidationError("FASTA contains no biological residues")

    if stripped_internal_whitespace:
        warnings.append("sequence_whitespace_ignored")
    if GAP_CHARS & all_residues:
        warnings.append("gap_characters_present")

    return ValidationResult(
        sha256=sha256(data).hexdigest(),
        sequence_type=_classify(all_residues),
        sequence_count=sequence_count,
        residue_count=residue_count,
        warnings=tuple(warnings),
    )
