from __future__ import annotations

import hashlib
import json

import pytest

from genithm_scientific_worker.sequence_insights import (
    CODONS,
    SequenceInsightsError,
    SequenceInput,
    analyze,
    canonical_sequence_insights_result,
    parse_nucleotide_fasta,
    reverse_complement,
    scan_motif,
    scan_orfs,
    six_frame_translation,
)


def test_universal_genetic_code_is_complete() -> None:
    assert len(CODONS) == 64
    assert CODONS["ATG"] == "M"
    assert CODONS["TAA"] == CODONS["TAG"] == CODONS["TGA"] == "*"
    assert CODONS["TGG"] == "W"
    assert CODONS["AAA"] == "K"


def test_parser_supports_dna_and_rna() -> None:
    assert parse_nucleotide_fasta(b">dna\nacgtn\n", sequence_type="dna").sequence == "ACGTN"
    assert parse_nucleotide_fasta(b">rna\nacgun\n", sequence_type="rna").sequence == "ACGUN"


@pytest.mark.parametrize("raw,sequence_type", [
    (b">one\nATG\n>two\nAAA\n", "dna"),
    (b"ACTG\n", "dna"),
    (b">one\nACGU\n", "dna"),
    (b">one\nACGT\n", "rna"),
    (b">one\nACG-T\n", "dna"),
    (b">one\nACGX\n", "dna"),
])
def test_parser_rejects_invalid_records(raw: bytes, sequence_type: str) -> None:
    with pytest.raises(SequenceInsightsError):
        parse_nucleotide_fasta(raw, sequence_type=sequence_type)


def test_reverse_complement_handles_ambiguous_n_and_rna() -> None:
    assert reverse_complement("ACGTN", sequence_type="dna") == "NACGT"
    assert reverse_complement("ACGUN", sequence_type="rna") == "NACGU"


def test_six_frame_translation_uses_standard_table_and_stop_symbol() -> None:
    frames = six_frame_translation("ATGAAATAA", "dna")
    assert len(frames) == 6
    assert frames[0] == {"strand": "+", "frame": 1, "protein": "MK*"}


def test_orf_scan_detects_complete_plus_and_minus_strand_orfs() -> None:
    forward, count = scan_orfs("ATGAAATAA", sequence_type="dna", min_aa=2)
    assert count == 1
    assert forward[0] == {
        "start_1based": 1,
        "end_1based": 9,
        "strand": "+",
        "frame": 1,
        "amino_acids": 2,
        "protein": "MK",
    }
    reverse, reverse_count = scan_orfs("TTATTTCAT", sequence_type="dna", min_aa=2)
    assert reverse_count == 1
    assert reverse[0]["strand"] == "-"
    assert reverse[0]["start_1based"] == 1
    assert reverse[0]["end_1based"] == 9
    assert reverse[0]["protein"] == "MK"


def test_orf_scan_requires_in_frame_stop_and_ignores_incomplete() -> None:
    assert scan_orfs("ATGAAAAAA", sequence_type="dna", min_aa=1) == ([], 0)


def test_overlapping_motif_hits_are_reported() -> None:
    hits, total = scan_motif("AAAA", sequence_type="dna", motif="AA")
    assert total == 6
    assert len(hits) == 6
    assert [(hit["start_1based"], hit["strand"]) for hit in hits] == [
        (1, "+"), (1, "-"), (2, "+"), (2, "-"), (3, "+"), (3, "-")
    ]


def test_motif_scan_supports_iupac_and_reverse_strand() -> None:
    hits, total = scan_motif("ACGT", sequence_type="dna", motif="ACG")
    assert total == 2
    assert {hit["strand"] for hit in hits} == {"+", "-"}
    hits, total = scan_motif("AG", sequence_type="dna", motif="RN")
    assert total >= 1


def test_parameter_contract_rejects_unapproved_shapes() -> None:
    seq = SequenceInput("ATGAAATAA", "dna")
    with pytest.raises(SequenceInsightsError):
        analyze(seq, operation="shell")
    with pytest.raises(SequenceInsightsError):
        analyze(seq, operation="motif_scan", motif="A*")
    with pytest.raises(SequenceInsightsError):
        analyze(seq, operation="orf_scan", min_aa=0)


def test_canonical_result_is_deterministic_and_provenance_bound() -> None:
    input_sha = hashlib.sha256(b">example\nATGAAATAA\n").hexdigest()
    job = {
        "parameters": {"operation": "orf_scan", "motif": None, "min_aa": 2},
        "tool_id": "genithm-sequence-insights",
        "tool_version": "0.1.0",
        "request_fingerprint": "a" * 64,
        "inputs": [{"position": 1, "role": "nucleotide_sequence", "sha256": input_sha, "sequence_type": "dna"}],
    }
    seq = SequenceInput("ATGAAATAA", "dna")
    first = canonical_sequence_insights_result(job, seq)
    second = canonical_sequence_insights_result(job, seq)
    assert first == second
    decoded = json.loads(first[0])
    assert decoded["summary"]["orf_count"] == 1
    assert decoded["summary"]["input_sha256"] == input_sha
    assert decoded["provenance"]["tool_version"] == "0.1.0"


def test_canonical_result_rejects_unexpected_parameters() -> None:
    with pytest.raises(SequenceInsightsError):
        canonical_sequence_insights_result(
            {
                "parameters": {"operation": "orf_scan", "min_aa": 2, "motif": None, "shell": "touch x"},
                "tool_id": "genithm-sequence-insights",
                "tool_version": "0.1.0",
                "inputs": [{"sequence_type": "dna"}],
            },
            SequenceInput("ATGAAATAA", "dna"),
        )
