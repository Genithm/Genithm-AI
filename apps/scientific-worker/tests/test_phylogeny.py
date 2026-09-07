from __future__ import annotations

from types import SimpleNamespace

import pytest

from genithm_scientific_worker import phylogeny
from genithm_scientific_worker.phylogeny import PhylogenyError, parse_newick, run_fasttree, validate_alignment


def test_alignment_requires_stable_msa_identifiers_and_equal_lengths() -> None:
    raw = b">seq2\nAC-C\n>seq1\nACGT\n>seq3\nA-GT\n"
    assert validate_alignment(raw, 3) == b">seq1\nACGT\n>seq2\nAC-C\n>seq3\nA-GT\n"

    with pytest.raises(PhylogenyError, match="aligned length"):
        validate_alignment(b">seq1\nACGT\n>seq2\nACC\n>seq3\nAGGT\n", 3)
    with pytest.raises(PhylogenyError, match="unexpected sequence identifier"):
        validate_alignment(b">alpha\nACGT\n>seq2\nACCT\n>seq3\nAGGT\n", 3)


def test_newick_parser_requires_exact_expected_leaves() -> None:
    tree, metrics = parse_newick(b"((seq1:0.1,seq2:0.2)0.95:0.1,seq3:0.3);\n", 3)
    assert tree == b"((seq1:0.1,seq2:0.2)0.95:0.1,seq3:0.3);\n"
    assert metrics.leaf_count == 3
    assert metrics.internal_support_count == 1

    with pytest.raises(PhylogenyError, match="duplicated"):
        parse_newick(b"(seq1:0.1,seq1:0.2,seq3:0.3);", 3)
    with pytest.raises(PhylogenyError, match="outside 0..1"):
        parse_newick(b"((seq1:0.1,seq2:0.2)1.5:0.1,seq3:0.3);", 3)
    with pytest.raises(PhylogenyError, match="trailing data"):
        parse_newick(b"(seq1:0.1,seq2:0.2,seq3:0.3);oops", 3)


def test_fasttree_invocation_is_allowlisted_for_nucleotide(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[list[str]] = []

    def fake_run(command: list[str], **_: object) -> SimpleNamespace:
        calls.append(command)
        return SimpleNamespace(returncode=0, stdout=b"(seq1:0.1,seq2:0.2,seq3:0.3);\n", stderr=b"")

    monkeypatch.setattr(phylogeny.subprocess, "run", fake_run)
    tree, metrics, model = run_fasttree(
        b">seq1\nACGT\n>seq2\nACCT\n>seq3\nAGGT\n",
        sequence_type="dna",
        expected_count=3,
    )
    assert tree.endswith(b";\n")
    assert metrics.leaf_count == 3
    assert model == "gtr_cat"
    assert calls and calls[0][:3] == ["/usr/bin/FastTree", "-nt", "-gtr"]


def test_fasttree_invocation_is_allowlisted_for_protein(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[list[str]] = []

    def fake_run(command: list[str], **_: object) -> SimpleNamespace:
        calls.append(command)
        return SimpleNamespace(returncode=0, stdout=b"(seq1:0.1,seq2:0.2,seq3:0.3);\n", stderr=b"")

    monkeypatch.setattr(phylogeny.subprocess, "run", fake_run)
    _, _, model = run_fasttree(
        b">seq1\nMKT-\n>seq2\nMRT-\n>seq3\nMKA-\n",
        sequence_type="protein",
        expected_count=3,
    )
    assert model == "jtt_cat"
    assert calls and calls[0][0] == "/usr/bin/FastTree"
    assert "-nt" not in calls[0]
