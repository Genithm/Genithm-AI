from __future__ import annotations

"""Read-only production gate for the Genithm Science V2 activation sequence."""

import argparse
import json
import os
import re
import subprocess
import sys
from dataclasses import dataclass
from typing import Any

EXPECTED = ("sequence", "source", "blast", "scientific", "audit", "ai")
MIN_VERSION = {"scientific": (0, 5, 0), "ai": (0, 5, 0)}
MAX_HEARTBEAT_AGE = 300

# The database itself computes heartbeat ages to avoid local clock drift.
# No customer, sequence, credential, or scientific result data is selected.
READINESS_QUERY = """
with heartbeat as (
  select worker_kind, worker_version,
    extract(epoch from (clock_timestamp() - last_seen_at)) as age_seconds
  from app_private.worker_runtime_heartbeats
), schema_gate as (
  select
    exists(select 1 from supabase_migrations.schema_migrations
           where version = '20261012101500') as sequence_schema_applied,
    exists(select 1 from supabase_migrations.schema_migrations
           where version = '20261012123000') as ai_schema_applied,
    to_regprocedure('public.request_sequence_insights(uuid,uuid,text,text,integer)') is not null
      as sequence_request_rpc,
    to_regprocedure('public.finish_sequence_insights_job_success(bigint,uuid,text,text,text,bigint,jsonb,jsonb)') is not null
      as sequence_finish_rpc,
    to_regprocedure('public.dispatch_ai_plan_service(uuid,uuid)') is not null
      as ai_dispatch_rpc,
    coalesce(position('request_sequence_insights' in
      pg_get_functiondef(to_regprocedure('app_private.dispatch_ai_plan_service(uuid,uuid)'))),0)>0
      as ai_sequence_route,
    coalesce(position('request.jwt.claim.sub' in
      pg_get_functiondef(to_regprocedure('app_private.dispatch_ai_plan_service(uuid,uuid)'))),0)>0
      as actor_binding
)
select jsonb_build_object(
  'workers', coalesce((select jsonb_agg(jsonb_build_object(
    'kind', worker_kind,
    'version', worker_version,
    'age_seconds', round(age_seconds::numeric,1)
  )) from heartbeat), '[]'::jsonb),
  'schema', to_jsonb(schema_gate)
)::text from schema_gate
"""


@dataclass(frozen=True)
class Assessment:
    stage: str
    ready: bool
    failures: tuple[str, ...]
    workers_fresh: int
    workers_expected: int

    def to_dict(self) -> dict[str, Any]:
        return {
            "stage": self.stage,
            "ready": self.ready,
            "failures": list(self.failures),
            "workers_fresh": self.workers_fresh,
            "workers_expected": self.workers_expected,
        }


def parse_version(value: object, worker: str) -> tuple[int, int, int] | None:
    if not isinstance(value, str):
        return None
    match = re.fullmatch(rf"genithm-{re.escape(worker)}-worker/(\d+)\.(\d+)\.(\d+)", value)
    if not match:
        return None
    return tuple(int(part) for part in match.groups())


def assess(snapshot: object, *, stage: str, stale_after_seconds: int = MAX_HEARTBEAT_AGE) -> Assessment:
    if stage not in {"workers", "schema"}:
        raise ValueError("stage must be workers or schema")
    if isinstance(stale_after_seconds, bool) or not 30 <= stale_after_seconds <= 900:
        raise ValueError("stale threshold must be 30-900 seconds")

    failures: list[str] = []
    if not isinstance(snapshot, dict):
        return Assessment(stage, False, ("database readiness response is not an object",), 0, len(EXPECTED))
    records = snapshot.get("workers")
    if not isinstance(records, list):
        records = []
        failures.append("worker heartbeat response is missing")
    indexed: dict[str, dict[str, Any]] = {}
    for item in records:
        if not isinstance(item, dict):
            failures.append("worker heartbeat contains an invalid record")
            continue
        kind = item.get("kind")
        if kind in EXPECTED:
            if kind in indexed:
                failures.append(f"duplicate heartbeat for {kind} worker")
            else:
                indexed[kind] = item

    fresh = 0
    for kind in EXPECTED:
        record = indexed.get(kind)
        if record is None:
            failures.append(f"{kind} worker heartbeat is missing")
            continue
        age = record.get("age_seconds")
        if isinstance(age, bool) or not isinstance(age, (int, float)) or not -60 <= age <= stale_after_seconds:
            failures.append(f"{kind} worker heartbeat is stale or invalid")
            continue
        version = record.get("version")
        if not isinstance(version, str) or not version:
            failures.append(f"{kind} worker version is missing")
            continue
        minimum = MIN_VERSION.get(kind)
        if minimum is not None:
            parsed = parse_version(version, kind)
            if parsed is None or parsed < minimum:
                failures.append(f"{kind} worker must report version >= {'.'.join(map(str, minimum))}")
                continue
        fresh += 1

    if stage == "schema":
        schema = snapshot.get("schema")
        fields = (
            "sequence_schema_applied",
            "ai_schema_applied",
            "sequence_request_rpc",
            "sequence_finish_rpc",
            "ai_dispatch_rpc",
            "ai_sequence_route",
            "actor_binding",
        )
        if not isinstance(schema, dict):
            failures.append("database schema readiness response is missing")
        else:
            for field in fields:
                if schema.get(field) is not True:
                    failures.append(f"database schema gate failed: {field}")

    return Assessment(stage, len(failures) == 0, tuple(failures), fresh, len(EXPECTED))


def query_database(*, timeout_seconds: int = 20) -> dict[str, Any]:
    # psql inherits PGHOST/PGSERVICE/PGUSER/PGDATABASE and a secret held
    # only in the operator environment or .pgpass; no credentials in argv.
    env = dict(os.environ)
    options = env.get("PGOPTIONS", "")
    env["PGOPTIONS"] = (options + " -c default_transaction_read_only=on").strip()
    result = subprocess.run(
        ["psql", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", READINESS_QUERY],
        capture_output=True, text=True, timeout=timeout_seconds,
        check=False, env=env,
    )
    if result.returncode != 0:
        raise RuntimeError("read-only Supabase readiness SQL failed; check the database connection and permissions")
    lines = [line for line in result.stdout.splitlines() if line.strip()]
    if len(lines) != 1:
        raise RuntimeError("read-only Supabase readiness SQL returned an unexpected response")
    try:
        parsed = json.loads(lines[0])
    except json.JSONDecodeError as exc:
        raise RuntimeError("database readiness SQL did not return valid JSON") from exc
    if not isinstance(parsed, dict):
        raise RuntimeError("database readiness SQL returned a non-object response")
    return parsed


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Fail-closed worker and schema readiness checks (read-only, no secrets in output)"
    )
    parser.add_argument("--stage", choices=("workers", "schema"), required=True)
    parser.add_argument("--stale-after-seconds", type=int, default=300)
    parser.add_argument("--json", action="store_true", help="Emit a machine-readable, non-sensitive result")
    args = parser.parse_args()
    try:
        status = assess(
            query_database(), stage=args.stage,
            stale_after_seconds=args.stale_after_seconds,
        )
    except (RuntimeError, ValueError, OSError, subprocess.TimeoutExpired) as exc:
        print(f"activation gate blocked: {exc}", file=sys.stderr)
        return 2

    if args.json:
        print(json.dumps(status.to_dict(), sort_keys=True))
    else:
        print(f"Genithm {args.stage} gate: {'PASS' if status.ready else 'BLOCKED'} "
              f"({status.workers_fresh}/{status.workers_expected} workers ready)")
        for failure in status.failures:
            print(f" - {failure}")
    return 0 if status.ready else 2


if __name__ == "__main__":
    raise SystemExit(main())
