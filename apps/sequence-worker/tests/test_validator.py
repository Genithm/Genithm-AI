import hashlib

import pytest

from genithm_sequence_worker.validator import FastaValidationError, VALIDATOR_VERSION, validate_fasta_bytes


def test_valid_dna_multirecord_counts_and_hash() -> None:
    data = b">seq1\nACGTN\n>seq2\nTTAA\n"
    result = validate_fasta_bytes(data)
    assert result.sequence_type == "dna"
    assert result.sequence_count == 2
    assert result.residue_count == 9
    assert result.sha256 == hashlib.sha256(data).hexdigest()
    assert result.validator_version == VALIDATOR_VERSION
    assert result.warnings == ()


def test_detects_rna() -> None:
    result = validate_fasta_bytes(b">rna\nAUGCUN\n")
    assert result.sequence_type == "rna"


def test_detects_protein() -> None:
    result = validate_fasta_bytes(b">protein\nMKWVTFISLLFLFSSAYSR\n")
    assert result.sequence_type == "protein"
    assert result.residue_count == 19


def test_t_and_u_nucleic_input_is_mixed() -> None:
    result = validate_fasta_bytes(b">mixed\nACGTU\n")
    assert result.sequence_type == "mixed"


def test_gaps_are_allowed_but_not_counted_as_residues() -> None:
    result = validate_fasta_bytes(b">aligned\nAC-G.T\n")
    assert result.residue_count == 4
    assert "gap_characters_present" in result.warnings


def test_duplicate_headers_warn() -> None:
    result = validate_fasta_bytes(b">same\nACGT\n>same\nTTTT\n")
    assert "duplicate_headers" in result.warnings


def test_internal_sequence_whitespace_warns() -> None:
    result = validate_fasta_bytes(b">seq\nAC GT\tN\n")
    assert result.residue_count == 5
    assert "sequence_whitespace_ignored" in result.warnings


@pytest.mark.parametrize(
    "data, message",
    [
        (b"", "empty"),
        (b"ACGT\n", "before the first FASTA header"),
        (b">\nACGT\n", "Header"),
        (b">first\n>second\nACGT\n", "has no sequence"),
        (b">bad\nACGT1\n", "Unsupported residue"),
        (b">bad\n\x00ACGT\n", "Binary NUL"),
    ],
)
def test_rejects_malformed_fasta(data: bytes, message: str) -> None:
    with pytest.raises(FastaValidationError, match=message):
        validate_fasta_bytes(data)
