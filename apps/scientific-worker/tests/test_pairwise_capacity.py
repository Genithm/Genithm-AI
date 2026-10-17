from __future__ import annotations

import itertools
import random
import tracemalloc

import pytest

from genithm_scientific_worker import runtime
from genithm_scientific_worker.pairwise import align
from pairwise_reference import reference_align


@pytest.mark.parametrize("algorithm", ["global", "local"])
@pytest.mark.parametrize("scores", [(2, -1, -2), (1, 0, -1), (0, 0, 0), (2, -3, 1)])
def test_exhaustive_short_alignment_parity(algorithm, scores):
    sequences = ["".join(x) for n in range(1, 5) for x in itertools.product("AC", repeat=n)]
    options = dict(algorithm=algorithm, match_score=scores[0], mismatch_score=scores[1], gap_score=scores[2])
    for a in sequences:
        for b in sequences:
            assert align(a, b, **options) == reference_align(a, b, **options)


def test_random_nucleotide_and_protein_alignment_parity():
    rng = random.Random(4101)
    for i in range(500):
        alphabet = "ACGTN" if i % 2 else "ACDEFGHIKLMNPQRSTVWY"
        a = "".join(rng.choices(alphabet, k=rng.randint(1, 70)))
        b = "".join(rng.choices(alphabet, k=rng.randint(1, 70)))
        options = dict(algorithm=rng.choice(["global", "local"]), match_score=rng.randint(1, 5),
                       mismatch_score=rng.randint(-4, 0), gap_score=rng.randint(-5, -1))
        assert align(a, b, **options) == reference_align(a, b, **options)


def test_result_bytes_and_fingerprints_remain_identical(monkeypatch):
    job = {
        "parameters": {"algorithm": "global", "match_score": 2, "mismatch_score": -1, "gap_score": -2},
        "request_fingerprint": "f" * 64,
        "inputs": [{"position": 1, "role": "sequence_a", "sha256": "a" * 64},
                   {"position": 2, "role": "sequence_b", "sha256": "b" * 64}],
    }
    new = runtime.canonical_pairwise_result(job, "GATTACAGG", "GCATGCA")
    monkeypatch.setattr(runtime, "align", reference_align)
    assert new == runtime.canonical_pairwise_result(job, "GATTACAGG", "GCATGCA")


def _peak(fn):
    tracemalloc.start()
    try:
        result = fn("ACGT" * 100, "ACTG" * 100, algorithm="global", match_score=2, mismatch_score=-1, gap_score=-2)
        peak = tracemalloc.get_traced_memory()[1]
        return result, peak
    finally:
        tracemalloc.stop()


def test_memory_reduction_is_measured_not_just_estimated():
    old, old_peak = _peak(reference_align)
    new, new_peak = _peak(align)
    assert old == new
    assert new_peak < old_peak / 10
    assert new_peak < 1024 * 1024
