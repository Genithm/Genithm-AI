from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

SHA_RE = re.compile(r"^[0-9a-f]{40}$")
SCHEMA = "genithm-v1-final-evidence/1"
REQUIRED_CHECKS = (
    "api_health",
    "web_health",
    "production_readiness",
    "r2_flow",
    "ncbi_flow",
    "blast_flow",
    "pairwise_flow",
    "msa_flow",
    "phylogeny_flow",
    "protein_flow",
    "audit_flow",
    "qwen_primary",
    "deepseek_fallback",
    "production_smoke",
    "scientific_e2e",
    "rollback_drill",
    "backup_recovery",
)


def fail(message: str) -> int:
    print(f"FAIL: {message}", file=sys.stderr)
    return 2


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate secretless live evidence before Genithm V1 final release.")
    parser.add_argument("--evidence", required=True, type=Path)
    parser.add_argument("--expected-source-sha", required=True)
    args = parser.parse_args()

    if not SHA_RE.fullmatch(args.expected_source_sha):
        return fail("--expected-source-sha must be a lowercase 40-character Git commit SHA")
    if not args.evidence.is_file():
        return fail(f"evidence file not found: {args.evidence}")

    try:
        data = json.loads(args.evidence.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return fail(f"invalid evidence JSON: {exc}")

    if data.get("schema") != SCHEMA:
        return fail(f"schema must be {SCHEMA}")
    if data.get("release") != "v1.0.0":
        return fail("release must be v1.0.0")
    if data.get("source_sha") != args.expected_source_sha:
        return fail("evidence source_sha does not match expected candidate source SHA")

    checks = data.get("checks")
    refs = data.get("evidence_refs")
    if not isinstance(checks, dict):
        return fail("checks must be an object")
    if not isinstance(refs, dict):
        return fail("evidence_refs must be an object")

    missing = [name for name in REQUIRED_CHECKS if checks.get(name) is not True]
    if missing:
        return fail("required live checks not proven true: " + ", ".join(missing))

    missing_refs = [name for name in REQUIRED_CHECKS if not isinstance(refs.get(name), str) or not refs[name].strip()]
    if missing_refs:
        return fail("required evidence references missing: " + ", ".join(missing_refs))

    readiness = data.get("readiness")
    if not isinstance(readiness, dict):
        return fail("readiness must be an object")
    if readiness.get("expected_workers") != 6:
        return fail("readiness.expected_workers must be 6")
    if readiness.get("healthy_workers") != 6:
        return fail("readiness.healthy_workers must be 6")
    if readiness.get("expected_queues") != 9:
        return fail("readiness.expected_queues must be 9")
    if readiness.get("healthy_queues") != 9:
        return fail("readiness.healthy_queues must be 9")
    if readiness.get("missing_workers") not in ([], None):
        return fail("readiness.missing_workers must be empty")
    if readiness.get("stale_workers") not in ([], None):
        return fail("readiness.stale_workers must be empty")
    if readiness.get("missing_queues") not in ([], None):
        return fail("readiness.missing_queues must be empty")
    if readiness.get("stale_queues") not in ([], None):
        return fail("readiness.stale_queues must be empty")

    print(f"PASS: Genithm {data['release']} final evidence is complete for {args.expected_source_sha}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
