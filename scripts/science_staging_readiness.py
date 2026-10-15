#!/usr/bin/env python3
"""V26 read-only, locally invoked staging science schema and lineage audit.

Requires an operator-controlled terminal, a separate staging database and
environment-provided connection URL. Never creates jobs, migrates or deploys.
"""
from __future__ import annotations

import argparse
import os
from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import parse_qs, urlsplit


PROJECT_REF = re.compile(r"^[a-z0-9]{20}$")
UUID = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    re.IGNORECASE,
)
ROOT = Path(__file__).resolve().parent.parent


class UnsafeTarget(ValueError):
    """Staging target is missing, malformed or indistinguishable from production."""


def validate_target(
    staging_ref: str, production_ref: str, url: str,
    message_id: str = "", run_id: str = "",
) -> None:
    if not PROJECT_REF.fullmatch(staging_ref) or not PROJECT_REF.fullmatch(production_ref):
        raise UnsafeTarget("Both staging and production project refs must be explicit 20-character identifiers.")
    if staging_ref == production_ref:
        raise UnsafeTarget("Refusing to connect to the production Supabase project.")
    try:
        parsed = urlsplit(url)
        port = parsed.port
    except ValueError as exc:
        raise UnsafeTarget("Invalid staging Postgres URL.") from exc
    if parsed.scheme not in ("postgresql", "postgres"):
        raise UnsafeTarget("Staging connection must use the PostgreSQL protocol.")
    if parsed.hostname != f"db.{staging_ref}.supabase.co":
        raise UnsafeTarget("Host must match the exact isolated staging database project ref.")
    if port not in (5432, None) or parsed.path != "/postgres":
        raise UnsafeTarget("Only the direct staging database on port 5432 is accepted.")
    if not parsed.username or not parsed.password:
        raise UnsafeTarget("A private staging Postgres URL is required.")
    ssl_modes = parse_qs(parsed.query).get("sslmode", [])
    if ssl_modes not in (["require"], ["verify-full"]):
        raise UnsafeTarget("Staging URL must explicitly require TLS with sslmode=require or verify-full.")
    if bool(message_id) != bool(run_id):
        raise UnsafeTarget("Both original message ID and run ID must be supplied together.")
    if message_id and (not UUID.fullmatch(message_id) or not UUID.fullmatch(run_id)):
        raise UnsafeTarget("Original message ID and run ID must be valid UUIDs.")


def run_sql(filename: str, url: str, variables: dict[str, str] | None = None) -> str:
    env = dict(os.environ)
    env["PGDATABASE"] = url  # never put a password in command arguments or logs
    env["PGCONNECT_TIMEOUT"] = "10"
    env["PGOPTIONS"] = "-c default_transaction_read_only=on"
    command = ["psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1"]
    for name, value in (variables or {}).items():
        command += ["-v", f"{name}={value}"]
    command += ["-f", str(ROOT / "supabase" / "tests" / filename)]
    try:
        result = subprocess.run(command, env=env, capture_output=True, text=True, timeout=60, check=False)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise RuntimeError("Cannot complete the read-only staging SQL check.") from exc
    if result.returncode:
        # Deliberately avoid printing raw database errors, URLs or credentials.
        raise RuntimeError("Read-only staging SQL check failed; inspect staging permissions and migrations.")
    return result.stdout


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Safely audit an isolated Supabase science staging database.")
    parser.add_argument("--message-id", default="", help="Optional approved staging chat message UUID")
    parser.add_argument("--run-id", default="", help="Matching completed staging science run UUID")
    args = parser.parse_args(argv)
    url = os.getenv("GENITHM_SCIENCE_STAGING_DATABASE_URL", "")
    staging_ref = os.getenv("GENITHM_STAGING_SUPABASE_REF", "")
    production_ref = os.getenv("GENITHM_PRODUCTION_SUPABASE_REF", "")

    try:
        validate_target(staging_ref, production_ref, url, args.message_id, args.run_id)
        status = run_sql("v26_science_release_readiness.sql", url)
        if not any(line.startswith("SCIENCE_V26_READY|") for line in status.splitlines()):
            print("SCIENCE_V26_BLOCKED: staging schema, forced RLS or function grants are not ready.")
            return 1
        print("SCIENCE_V26_READY: staging database schema and security boundaries passed.")

        if args.message_id:
            evidence = run_sql(
                "v25_staging_evidence_readonly.sql", url,
                {"message_id": args.message_id, "run_id": args.run_id},
            )
            if "PASS: recorded lineage consistent" not in evidence:
                print("Science lineage incomplete or unavailable; release remains blocked.")
                return 1
            print("Recorded lineage passes. Validate authenticated artifact bytes separately.")
        else:
            print("No completed run was supplied; real NCBI/scientific-worker E2E remains unverified.")
        return 0
    except (UnsafeTarget, RuntimeError) as exc:
        print(str(exc), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
