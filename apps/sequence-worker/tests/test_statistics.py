from __future__ import annotations

import pytest

from genithm_sequence_worker.statistics import (
    GC_METHOD,
    STATISTICS_VERSION,
    calculate_sequence_statistics,
)


def test_dna_statistics_are_deterministic() -> None:
    result = calculate_sequence_statistics(b">seq1\nACGTN\n>seq2\nGGCC\n")

    assert result.statistics_version == STATISTICS_VERSION
    assert result.sequence_type == "dna"
    assert result.sequence_count == 2
    assert result.residue_count == 9
    assert result.min_record_length == 4
    assert result.max_record_length == 5
    assert result.mean_record_length == 4.5
    assert result.composition == {"A": 1, "C": 3, "G": 3, "N": 1, "T": 1}
    assert result.frequencies["N"] == pytest.approx(1 / 9)
    assert result.gc_denominator_count == 8
    assert result.gc_content_percent == 75.0
    assert result.gc_method == GC_METHOD
    assert result.gap_count == 0


def test_rna_gc_uses_u_in_canonical_denominator() -> None:
    result = calculate_sequence_statistics(b">rna\nAUGCGN\n")

    assert result.sequence_type == "rna"
    assert result.gc_denominator_count == 5
    assert result.gc_content_percent == 60.0
    assert result.composition == {"A": 1, "C": 1, "G": 2, "N": 1, "U": 1}


def test_ambiguous_nucleotide_symbols_do_not_change_gc_denominator() -> None:
    result = calculate_sequence_statistics(b">dna\nACGTNNNN\n")

    assert result.residue_count == 8
    assert result.gc_denominator_count == 4
    assert result.gc_content_percent == 50.0


def test_protein_statistics_do_not_report_gc() -> None:
    result = calculate_sequence_statistics(b">protein\nMKWVTFISLL\n")

    assert result.sequence_type == "protein"
    assert result.gc_content_percent is None
    assert result.gc_denominator_count is None
    assert result.gc_method is None
    assert result.composition["L"] == 2
    assert result.composition["M"] == 1


def test_gaps_are_counted_separately_and_excluded_from_length() -> None:
    result = calculate_sequence_statistics(b">aligned\nAC-G.T\n")

    assert result.residue_count == 4
    assert result.gap_count == 2
    assert result.min_record_length == 4
    assert result.max_record_length == 4
    assert result.composition == {"A": 1, "C": 1, "G": 1, "T": 1}


def test_internal_whitespace_is_ignored_consistently_with_validator() -> None:
    result = calculate_sequence_statistics(b">seq\nAC GT\tN\n")

    assert result.residue_count == 5
    assert result.composition == {"A": 1, "C": 1, "G": 1, "N": 1, "T": 1}


def test_payload_is_explicit_about_method_and_record_lengths() -> None:
    payload = calculate_sequence_statistics(b">a\nACGT\n>b\nGG\n").to_payload()

    assert payload["statistics_version"] == STATISTICS_VERSION
    assert payload["gc_method"] == GC_METHOD
    assert payload["record_length"] == {"min": 2, "max": 4, "mean": 3.0}
    assert payload["composition"] == {"A": 1, "C": 1, "G": 3, "T": 1}


def test_invalid_fasta_is_rejected_before_statistics() -> None:
    with pytest.raises(ValueError, match="Unsupported residue"):
        calculate_sequence_statistics(b">bad\nACGT1\n")
