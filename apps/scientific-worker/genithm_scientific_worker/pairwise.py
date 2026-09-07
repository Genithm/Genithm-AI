from __future__ import annotations

from dataclasses import dataclass

TOOL_ID = "genithm-pairwise-aligner"
TOOL_VERSION = "0.1.0"
EXECUTOR_VERSION = "genithm-scientific-worker/0.2.0"
GAPS = frozenset("-.")


class PairwiseAlignmentError(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class AlignmentResult:
    algorithm: str
    score: int
    aligned_a: str
    aligned_b: str
    matches: int
    mismatches: int
    gaps: int

    @property
    def aligned_length(self) -> int:
        return len(self.aligned_a)

    @property
    def identity_percent(self) -> float:
        if not self.aligned_a:
            return 0.0
        return round((self.matches / len(self.aligned_a)) * 100.0, 6)


def parse_single_fasta(data: bytes) -> str:
    if not data or len(data) > 2 * 1024 * 1024:
        raise PairwiseAlignmentError("FASTA input is empty or exceeds worker read limit")
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise PairwiseAlignmentError("FASTA input must be UTF-8 text") from exc
    records: list[list[str]] = []
    current: list[str] | None = None
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        if line.startswith(">"):
            if current is not None:
                records.append(current)
            current = []
            continue
        if current is None:
            raise PairwiseAlignmentError("sequence appears before FASTA header")
        current.extend(ch.upper() for ch in line if not ch.isspace())
    if current is not None:
        records.append(current)
    if len(records) != 1:
        raise PairwiseAlignmentError("pairwise alignment requires exactly one FASTA record per input")
    sequence = "".join(records[0])
    if not sequence:
        raise PairwiseAlignmentError("FASTA record contains no sequence")
    if any(ch in GAPS for ch in sequence):
        raise PairwiseAlignmentError("pairwise alignment requires ungapped input sequences")
    return sequence


def _metrics(a: str, b: str) -> tuple[int, int, int]:
    matches = mismatches = gaps = 0
    for x, y in zip(a, b, strict=True):
        if x == "-" or y == "-":
            gaps += 1
        elif x == y:
            matches += 1
        else:
            mismatches += 1
    return matches, mismatches, gaps


def align(
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
    trace = [[0] * (m + 1) for _ in range(n + 1)]  # 1 diag, 2 up, 3 left

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
