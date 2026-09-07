from __future__ import annotations

import hashlib
import json

import pytest

from genithm_scientific_worker.pairwise import PairwiseAlignmentError, align, parse_single_fasta
from genithm_scientific_worker.runtime import canonical_pairwise_result


def test_global_alignment_is_deterministic() -> None:
    result = align("GATTACA", "GCATGCU", algorithm="global", match_score=2, mismatch_score=-1, gap_score=-2)
    assert result.aligned_a == "GATTACA"
    assert result.aligned_b == "GCATGCU"
    assert result.score == 2
    assert result.matches == 3
    assert result.mismatches == 4
    assert result.gaps == 0
    assert result.identity_percent == pytest.approx(42.857143)


def test_local_alignment_extracts_best_region() -> None:
    result = align("TTACGTAA", "GGACGTCC", algorithm="local", match_score=2, mismatch_score=-1, gap_score=-2)
    assert result.aligned_a == "ACGT"
    assert result.aligned_b == "ACGT"
    assert result.score == 8
    assert result.identity_percent == 100.0


def test_global_tie_break_prefers_diagonal_then_up_then_left() -> None:
    first = align("AA", "A", algorithm="global", match_score=1, mismatch_score=0, gap_score=-1)
    second = align("AA", "A", algorithm="global", match_score=1, mismatch_score=0, gap_score=-1)
    assert first == second


def test_fasta_parser_requires_one_ungapped_record() -> None:
    assert parse_single_fasta(b">x\nACGT\n") == "ACGT"
    with pytest.raises(PairwiseAlignmentError, match="exactly one"):
        parse_single_fasta(b">a\nAC\n>b\nGT\n")
    with pytest.raises(PairwiseAlignmentError, match="ungapped"):
        parse_single_fasta(b">a\nAC-GT\n")


def test_dynamic_programming_limit_is_enforced() -> None:
    with pytest.raises(PairwiseAlignmentError, match="cell limit"):
        align("A" * 3001, "A" * 3000, algorithm="global", match_score=2, mismatch_score=-1, gap_score=-2)


def test_canonical_result_has_integrity_stable_json() -> None:
    job = {
        "parameters": {"algorithm": "global", "match_score": 2, "mismatch_score": -1, "gap_score": -2},
        "request_fingerprint": "f" * 64,
        "inputs": [
            {"position": 1, "role": "sequence_a", "sha256": "a" * 64},
            {"position": 2, "role": "sequence_b", "sha256": "b" * 64},
        ],
    }
    data, summary, provenance = canonical_pairwise_result(job, "ACGT", "ACCT")
    parsed = json.loads(data)
    assert parsed["summary"] == summary
    assert parsed["provenance"] == provenance
    assert provenance["executor_version"] == "genithm-scientific-worker/0.2.0"
    assert summary["input_a_sha256"] == "a" * 64
    assert summary["input_b_sha256"] == "b" * 64
    assert len(hashlib.sha256(data).hexdigest()) == 64
