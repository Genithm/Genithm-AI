#!/usr/bin/env python3
"""Run all four actual Genithm sequence algorithms locally, without database or workers."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "apps" / "scientific-worker"))

from genithm_scientific_worker.sequence_insights import (  # noqa: E402
    SequenceInsightsError,
    analyze,
    parse_nucleotide_fasta,
)


def smoke() -> dict[str, object]:
    """Exercise the production algorithm module against a bounded known DNA fixture."""
    sequence = parse_nucleotide_fasta(b">codespaces-demo\nATGAAATAA\n", sequence_type="dna")
    orf_summary, orfs = analyze(sequence, operation="orf_scan", min_aa=2)
    translation_summary, translation = analyze(sequence, operation="six_frame_translation")
    motif_summary, motifs = analyze(sequence, operation="motif_scan", motif="AAA")
    reverse_summary, reverse = analyze(sequence, operation="reverse_complement")

    assert orf_summary["orf_count"] == 1
    assert orfs["orfs"][0]["protein"] == "MK"
    assert orfs["orfs"][0]["start_1based"] == 1
    assert orfs["orfs"][0]["end_1based"] == 9
    assert translation_summary["frame_count"] == 6
    assert translation["frames"][0]["protein"] == "MK*"
    assert motif_summary["motif_hits"] == 1
    assert motifs["hits"][0] == {"start_1based": 4, "end_1based": 6, "strand": "+"}
    assert reverse_summary["output_length"] == 9
    assert reverse["reverse_complement"] == "TTATTTCAT"

    return {
        "mode": "codespaces-offline-smoke",
        "source": "genithm_scientific_worker.sequence_insights",
        "input": "ATGAAATAA",
        "results": {
            "orf_scan": orf_summary,
            "six_frame_translation": translation_summary,
            "motif_scan": motif_summary,
            "reverse_complement": reverse_summary,
        },
        "passed": 4,
    }


if __name__ == "__main__":
    try:
        print(json.dumps(smoke(), sort_keys=True))
    except (SequenceInsightsError, AssertionError) as exc:
        print(f"Genithm offline scientific smoke failed: {type(exc).__name__}", file=sys.stderr)
        raise SystemExit(1) from exc
