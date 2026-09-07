from __future__ import annotations

import pytest

from genithm_scientific_worker.msa import MsaError, build_mafft_input, parse_alignment, parse_single_fasta


def test_single_fasta_parser_requires_one_ungapped_record() -> None:
    assert parse_single_fasta(b">x\nACGT\n") == "ACGT"
    with pytest.raises(MsaError, match="one FASTA record"):
        parse_single_fasta(b">a\nAC\n>b\nGT\n")
    with pytest.raises(MsaError, match="ungapped"):
        parse_single_fasta(b">a\nAC-GT\n")


def test_mafft_input_has_stable_internal_identifiers() -> None:
    data = build_mafft_input(["ACGT", "ACCT", "AGGT"])
    assert data == b">seq1\nACGT\n>seq2\nACCT\n>seq3\nAGGT\n"


def test_msa_sequence_count_bounds_are_enforced() -> None:
    with pytest.raises(MsaError, match="between 3 and 50"):
        build_mafft_input(["A", "A"])
    with pytest.raises(MsaError, match="between 3 and 50"):
        build_mafft_input(["A"] * 51)


def test_msa_total_residue_budget_is_enforced() -> None:
    with pytest.raises(MsaError, match="total residues"):
        build_mafft_input(["A" * 40_000, "A" * 40_000, "A" * 20_001])


def test_alignment_output_is_reordered_and_integrity_checked() -> None:
    raw = b">seq2\nAC-C\n>seq1\nACGT\n>seq3\nA-GT\n"
    records = parse_alignment(raw, ["ACGT", "ACC", "AGT"])
    assert [record.record_id for record in records] == ["seq1", "seq2", "seq3"]
    assert [record.sequence for record in records] == ["ACGT", "AC-C", "A-GT"]


def test_alignment_rejects_mutated_input_content() -> None:
    raw = b">seq1\nACGT\n>seq2\nATCT\n>seq3\nAGGT\n"
    with pytest.raises(MsaError, match="integrity"):
        parse_alignment(raw, ["ACGT", "ACCT", "AGGT"])


def test_alignment_requires_equal_lengths_and_known_ids() -> None:
    with pytest.raises(MsaError, match="aligned length"):
        parse_alignment(b">seq1\nACGT\n>seq2\nACC\n>seq3\nAGGT\n", ["ACGT", "ACC", "AGGT"])
    with pytest.raises(MsaError, match="unexpected sequence identifier"):
        parse_alignment(b">alpha\nACGT\n>seq2\nACCT\n>seq3\nAGGT\n", ["ACGT", "ACCT", "AGGT"])
