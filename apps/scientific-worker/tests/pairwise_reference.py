"""Frozen pre-V41 full-matrix reference, used only for parity/benchmarks.
Not imported by the production executor. Preserves all legacy tie behavior.
"""
from genithm_scientific_worker.pairwise import AlignmentResult, PairwiseAlignmentError, _metrics

def reference_align(
    sequence_a: str,
    sequence_b: str,
    *,
    algorithm: str,
    match_score: int,
    mismatch_score: int,
    gap_score: int,
) -> AlignmentResult:
    if algorithm not in {"global", "local"}:
        raise PairwiseAlignmentError("unsupported alignment algorithm")
    if not sequence_a or not sequence_b:
        raise PairwiseAlignmentError("alignment inputs must not be empty")
    if len(sequence_a) * len(sequence_b) > 9_000_000:
        raise PairwiseAlignmentError("alignment exceeds V1 dynamic-programming cell limit")

    n, m = len(sequence_a), len(sequence_b)
    scores = [[0] * (m + 1) for _ in range(n + 1)]
    trace = [[0] * (m + 1) for _ in range(n + 1)]

    if algorithm == "global":
        for i in range(1, n + 1):
            scores[i][0] = i * gap_score
            trace[i][0] = 2
        for j in range(1, m + 1):
            scores[0][j] = j * gap_score
            trace[0][j] = 3

    best_score = 0 if algorithm == "local" else scores[n][m]
    best_i, best_j = (0, 0) if algorithm == "local" else (n, m)

    for i in range(1, n + 1):
        ai = sequence_a[i - 1]
        for j in range(1, m + 1):
            diagonal = scores[i - 1][j - 1] + (match_score if ai == sequence_b[j - 1] else mismatch_score)
            up = scores[i - 1][j] + gap_score
            left = scores[i][j - 1] + gap_score
            if algorithm == "local":
                value = max(0, diagonal, up, left)
                if value == 0:
                    direction = 0
                elif value == diagonal:
                    direction = 1
                elif value == up:
                    direction = 2
                else:
                    direction = 3
            else:
                value = max(diagonal, up, left)
                if value == diagonal:
                    direction = 1
                elif value == up:
                    direction = 2
                else:
                    direction = 3
            scores[i][j] = value
            trace[i][j] = direction
            if algorithm == "local" and value > best_score:
                best_score, best_i, best_j = value, i, j

    if algorithm == "global":
        best_score, best_i, best_j = scores[n][m], n, m

    aligned_a: list[str] = []
    aligned_b: list[str] = []
    i, j = best_i, best_j
    while i > 0 or j > 0:
        if algorithm == "local" and scores[i][j] == 0:
            break
        direction = trace[i][j]
        if direction == 1:
            aligned_a.append(sequence_a[i - 1])
            aligned_b.append(sequence_b[j - 1])
            i -= 1
            j -= 1
        elif direction == 2:
            aligned_a.append(sequence_a[i - 1])
            aligned_b.append("-")
            i -= 1
        elif direction == 3:
            aligned_a.append("-")
            aligned_b.append(sequence_b[j - 1])
            j -= 1
        else:
            break

    out_a = "".join(reversed(aligned_a))
    out_b = "".join(reversed(aligned_b))
    matches, mismatches, gaps = _metrics(out_a, out_b)
    return AlignmentResult(algorithm, best_score, out_a, out_b, matches, mismatches, gaps)
