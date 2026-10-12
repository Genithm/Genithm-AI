#!/usr/bin/env python3
"""Development-only process bridge to the real sequence insights engine.

Invoked by the local Next.js route using a fixed Python script path and
a single bounded JSON argv payload. No Supabase, network, or shell execution.
"""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "apps" / "scientific-worker"))

from genithm_scientific_worker.sequence_insights import (  # noqa: E402
    OPERATIONS,
    TOOL_ID,
    TOOL_VERSION,
    SequenceInsightsError,
    analyze,
    parse_nucleotide_fasta,
)

from genithm_scientific_worker.sequence_composition import (
    VERSION as COMPOSITION_VERSION,
    analyze_composition,
)

ALLOWED_OPERATIONS = OPERATIONS | frozenset({"composition_profile"})
MAX_LAB_BASES = 5000
MAX_INPUT_CHARS = 5500
EXPECTED_FIELDS = frozenset({"sequence", "sequence_type", "operation", "motif", "min_aa"})
MOTIF_ALPHABET = frozenset("ACGTRYSWKMBDHVNU")


def compute(payload: object) -> dict[str, object]:
    if not isinstance(payload, dict) or frozenset(payload) != EXPECTED_FIELDS:
        raise ValueError("invalid scientific lab request fields")

    source = payload["sequence"]
    sequence_type = payload["sequence_type"]
    operation = payload["operation"]
    motif = payload["motif"]
    min_aa = payload["min_aa"]

    if not isinstance(source, str) or not 1 <= len(source) <= MAX_INPUT_CHARS:
        raise ValueError("provide 1-5500 characters of DNA/RNA sequence or single-record FASTA")
    if sequence_type not in ("dna", "rna") or not isinstance(sequence_type, str):
        raise ValueError("select DNA or RNA")
    if not isinstance(operation, str) or operation not in ALLOWED_OPERATIONS:
        raise ValueError("select an approved sequence analysis")
    if type(min_aa) is not int or not 1 <= min_aa <= 1000:
        raise ValueError("ORF minimum must be an integer from 1 to 1000")
    if operation == "motif_scan":
        if not isinstance(motif, str) or not 2 <= len(motif) <= 32 or not frozenset(motif) <= MOTIF_ALPHABET:
            raise ValueError("motif must contain 2-32 uppercase IUPAC nucleotides")
        if min_aa != 30:
            raise ValueError("motif scans must use the default ORF minimum")
    elif motif is not None:
        raise ValueError("motif is only allowed for motif scans")
    if operation != "orf_scan" and min_aa != 30:
        raise ValueError("custom ORF minimum is only allowed for ORF detection")

    stripped = source.strip()
    fasta = stripped if stripped.startswith(">") else ">codespaces-local\n" + stripped
    item = parse_nucleotide_fasta(fasta.encode("utf-8"), sequence_type=sequence_type)
    if len(item.sequence) > MAX_LAB_BASES:
        raise ValueError("Codespaces interactive analysis is limited to 5000 bases")

    if operation == "composition_profile":
        summary, result = analyze_composition(item)
        tool = {"id": "genithm-local-composition", "version": COMPOSITION_VERSION}
    else:
        summary, result = analyze(item, operation=operation, motif=motif, min_aa=min_aa)
        tool = {"id": TOOL_ID, "version": TOOL_VERSION}
    return {
        "mode": "local-development-only",
        "persistence": "none",
        "summary": summary,
        "result": result,
        "input_sha256": hashlib.sha256(item.sequence.encode("ascii")).hexdigest(),
        "tool": tool,
        "genetic_code": "NCBI_translation_table_1",
    }


def main() -> int:
    try:
        if len(sys.argv) != 2:
            raise ValueError("expected exactly one bounded JSON request")
        if len(sys.argv[1]) > 8192:
            raise ValueError("request is too large")
        output = compute(json.loads(sys.argv[1]))
        print(json.dumps(output, separators=(",", ":"), sort_keys=True))
        return 0
    except (ValueError, UnicodeError, SequenceInsightsError, json.JSONDecodeError) as exc:
        print(json.dumps({"error": str(exc)}), flush=True)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
