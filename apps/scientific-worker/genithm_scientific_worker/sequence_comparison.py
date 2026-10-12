from __future__ import annotations

"""Codespaces-only nucleotide comparisons using the production pairwise engine.

The comparison matrix is N(N-1)/2 independent global pairwise alignments.
It is NOT a multiple-sequence alignment, distance tree or homology inference.
"""

import hashlib
import re
from dataclasses import dataclass
from typing import Any

from .pairwise import TOOL_ID, TOOL_VERSION, align

MAX_PAIR_BASES = 700
MAX_MATRIX_BASES = 150
MAX_RECORDS = 6
MAX_MATRIX_DP_CELLS = 350_000
MATCH_SCORE = 2
MISMATCH_SCORE = -1
GAP_SCORE = -2
IDENTIFIER = re.compile(r"[A-Za-z0-9_.-]{1,40}\Z")


@dataclass(frozen=True, slots=True)
class Record:
    name: str
    sequence: str


def parse_comparison_fasta(text: str, *, sequence_type: str) -> list[Record]:
    if not isinstance(text, str) or not 1 <= len(text) <= 5500:
        raise ValueError("FASTA input must contain 1-5500 characters")
    if sequence_type not in {"dna", "rna"}:
        raise ValueError("comparison requires DNA or RNA sequences")
    records: list[Record] = []
    current_name: str | None = None
    current_lines: list[str] = []
    alphabet = set("ACGTN" if sequence_type == "dna" else "ACGUN")

    def add_record() -> None:
        if current_name is None:
            return
        sequence = "".join(current_lines)
        if not sequence or not set(sequence) <= alphabet:
            raise ValueError("comparison FASTA must contain ungapped DNA/RNA only")
        if len(sequence) > MAX_PAIR_BASES:
            raise ValueError("each comparison FASTA record may contain at most 700 bases")
        records.append(Record(current_name, sequence))

    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        if line.startswith(">"):
            add_record()
            if len(records) >= MAX_RECORDS:
                raise ValueError("comparative analysis permits at most six FASTA records")
            current_name = line[1:]
            if not IDENTIFIER.fullmatch(current_name):
                raise ValueError("FASTA IDs must be 1-40 letters, numbers, underscores, periods or hyphens")
            current_lines = []
        else:
            if current_name is None:
                raise ValueError("comparison requires named FASTA records")
            current_lines.append("".join(line.upper().split()))
    add_record()
    if len(records) < 2:
        raise ValueError("comparison requires at least two FASTA records")
    if len({record.name for record in records}) != len(records):
        raise ValueError("comparison FASTA record names must be unique")
    return records


def compare(payload: dict[str, Any]) -> dict[str, Any]:
    expected = {"sequence", "sequence_type", "operation", "motif", "min_aa"}
    if set(payload) != expected:
        raise ValueError("invalid comparison request fields")
    operation = payload["operation"]
    if operation not in ("pairwise_global", "pairwise_local", "comparison_matrix"):
        raise ValueError("comparison operation is not supported")
    if payload["motif"] is not None or type(payload["min_aa"]) is not int or payload["min_aa"] != 30:
        raise ValueError("comparison parameters must use the approved defaults")
    records = parse_comparison_fasta(payload["sequence"], sequence_type=payload["sequence_type"])
    is_matrix = operation == "comparison_matrix"
    if is_matrix:
        if not 3 <= len(records) <= MAX_RECORDS:
            raise ValueError("comparison matrix requires between three and six FASTA records")
        if any(len(record.sequence) > MAX_MATRIX_BASES for record in records):
            raise ValueError("matrix records may contain at most 150 bases")
        total_cells = sum(
            len(records[i].sequence) * len(records[j].sequence)
            for i in range(len(records)) for j in range(i + 1, len(records))
        )
        if total_cells > MAX_MATRIX_DP_CELLS:
            raise ValueError("comparison matrix exceeds compute budget")
    elif len(records) != 2:
        raise ValueError("pairwise alignment requires exactly two FASTA records")

    canonical = "".join(f">{record.name}\n{record.sequence}\n" for record in records)
    sha = hashlib.sha256(canonical.encode("ascii")).hexdigest()
    options = {
        "match_score": MATCH_SCORE,
        "mismatch_score": MISMATCH_SCORE,
        "gap_score": GAP_SCORE,
    }
    result: dict[str, Any]
    summary: dict[str, Any] = {
        "operation": operation,
        "sequence_type": payload["sequence_type"],
        "sequence_count": len(records),
        "total_bases": sum(len(record.sequence) for record in records),
        "score_scheme": options,
    }
    if is_matrix:
        n = len(records)
        matrix = [[100.0 if i == j else 0.0 for j in range(n)] for i in range(n)]
        pair_metrics: list[dict[str, Any]] = []
        for i in range(n):
            for j in range(i + 1, n):
                aligned = align(records[i].sequence, records[j].sequence, algorithm="global", **options)
                identity = aligned.identity_percent
                matrix[i][j] = matrix[j][i] = identity
                pair_metrics.append({
                    "record_a": records[i].name,
                    "record_b": records[j].name,
                    "identity_percent": identity,
                    "alignment_length": aligned.aligned_length,
                    "score": aligned.score,
                    "gaps": aligned.gaps,
                })
        summary["comparisons"] = len(pair_metrics)
        result = {
            "records": [{"name": r.name, "length": len(r.sequence)} for r in records],
            "identity_matrix": matrix,
            "pairs": pair_metrics,
            "method": "Independent global pairwise identity (matches/aligned columns), not an MSA or phylogeny.",
        }
    else:
        a, b = records
        algorithm = "global" if operation == "pairwise_global" else "local"
        aligned = align(a.sequence, b.sequence, algorithm=algorithm, **options)
        summary.update({
            "algorithm": algorithm,
            "score": aligned.score,
            "identity_percent": aligned.identity_percent,
            "alignment_length": aligned.aligned_length,
            "matches": aligned.matches,
            "mismatches": aligned.mismatches,
            "gap_columns": aligned.gaps,
            "coverage_a_percent": round(100 * (aligned.matches + aligned.mismatches +
                sum(x != "-" and y == "-" for x, y in zip(aligned.aligned_a, aligned.aligned_b))) / len(a.sequence), 4),
            "coverage_b_percent": round(100 * (aligned.matches + aligned.mismatches +
                sum(y != "-" and x == "-" for x, y in zip(aligned.aligned_a, aligned.aligned_b))) / len(b.sequence), 4),
        })
        result = {
            "record_a": {"name": a.name, "length": len(a.sequence)},
            "record_b": {"name": b.name, "length": len(b.sequence)},
            "aligned_a": aligned.aligned_a,
            "aligned_b": aligned.aligned_b,
            "comparison": "".join(
                "|" if x == y and x != "-" else " " if "-" in (x, y) else "."
                for x, y in zip(aligned.aligned_a, aligned.aligned_b)
            ),
            "method": "Needleman-Wunsch global" if algorithm == "global" else "Smith-Waterman local",
            "identity_denominator": "All alignment columns (including gaps); literal N equals only N.",
        }
    return {
        "mode": "local-development-only",
        "persistence": "none",
        "summary": summary,
        "result": result,
        "input_sha256": sha,
        "tool": {"id": TOOL_ID, "version": TOOL_VERSION},
        "genetic_code": None,
    }
