from __future__ import annotations

from dataclasses import dataclass

TOOL_ID = "genithm-pairwise-aligner"
TOOL_VERSION = "0.1.0"
EXECUTOR_VERSION = "genithm-scientific-worker/0.3.0"
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

    # Exact same scoring and tie-breaking as V1, without two Python object
    # matrices. Keep two score rows and one byte per traceback cell. The
    # existing nine-million-cell safety limit and scientific artifact format
    # are intentionally unchanged. Do not transpose inputs: local alignment
    # selects the first row-major optimum and ties are orientation-sensitive.
    n, m = len(sequence_a), len(sequence_b)
    stride = m + 1
    trace = bytearray((n + 1) * stride)
    local = algorithm == "local"
    previous = [0] * stride if local else [j * gap_score for j in range(stride)]
    current = [0] * stride
    if not local:
        trace[1:stride] = b"\x03" * m
        for i in range(1, n + 1):
            trace[i * stride] = 2

    best_score = 0
    best_i = best_j = 0
    for i in range(1, n + 1):
        current[0] = 0 if local else i * gap_score
        ai = sequence_a[i - 1]
        row = i * stride
        for j in range(1, stride):
            diagonal = previous[j - 1] + (match_score if ai == sequence_b[j - 1] else mismatch_score)
            up = previous[j] + gap_score
            left = current[j - 1] + gap_score
            # Strict comparisons preserve diagonal > up > left tie priority.
            value, direction = diagonal, 1
            if up > value:
                value, direction = up, 2
            if left > value:
                value, direction = left, 3
            if local and value <= 0:
                value, direction = 0, 0
            current[j] = value
            trace[row + j] = direction
            if local and value > best_score:
                best_score, best_i, best_j = value, i, j
        previous, current = current, previous

    if not local:
        best_score, best_i, best_j = previous[m], n, m

    aligned_a: list[str] = []
    aligned_b: list[str] = []
    i, j = best_i, best_j
    while i > 0 or j > 0:
        # A zero traceback byte is the local-alignment stop marker.
        direction = trace[i * stride + j]
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
