from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

from render_v1_deployment_env import _load, render_env


def run(cmd: list[str], *, cwd: Path) -> None:
    print("+", " ".join(cmd))
    proc = subprocess.run(cmd, cwd=cwd, check=False)
    if proc.returncode != 0:
        raise SystemExit(proc.returncode)


def parse_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip()
    return values


def required_image_keys(role: str) -> tuple[str, ...]:
    if role == "api":
        return ("GENITHM_API_IMAGE", "GENITHM_CLOUDFLARED_IMAGE")
    return (
        "GENITHM_SEQUENCE_WORKER_IMAGE",
        "GENITHM_SOURCE_WORKER_IMAGE",
        "GENITHM_BLAST_WORKER_IMAGE",
        "GENITHM_SCIENTIFIC_WORKER_IMAGE",
        "GENITHM_AUDIT_WORKER_IMAGE",
        "GENITHM_AI_WORKER_IMAGE",
    )


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Rollback Genithm V1 to a previously approved digest-pinned release on a prepared Oracle host."
    )
    parser.add_argument("role", choices=("api", "workers"))
    parser.add_argument("--env-file", required=True, type=Path)
    parser.add_argument("--bundle", required=True, type=Path)
    parser.add_argument("--expected-source-sha", required=True)
    parser.add_argument("--evidence-out", type=Path)
    parser.add_argument("--confirm", required=True, help="Required literal acknowledgement: ROLLBACK")
    args = parser.parse_args()

    if args.confirm != "ROLLBACK":
        print("FAIL: rollback requires --confirm ROLLBACK", file=sys.stderr)
        return 2

    repo = Path(__file__).resolve().parents[1]
    env_file = args.env_file.resolve()
    bundle_file = args.bundle.resolve()
    if not env_file.is_file():
        print(f"FAIL: env file not found: {env_file}", file=sys.stderr)
        return 2
    if not bundle_file.is_file():
        print(f"FAIL: release bundle not found: {bundle_file}", file=sys.stderr)
        return 2

    try:
        bundle = _load(bundle_file)
        rendered = render_env(bundle)
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        print(f"FAIL: invalid rollback release bundle: {exc}", file=sys.stderr)
        return 2

    if bundle.get("source_revision") != args.expected_source_sha:
        print("FAIL: rollback bundle source_revision does not match --expected-source-sha", file=sys.stderr)
        return 2

    approved_images = parse_env(Path("/dev/null")) if False else {}
    for line in rendered.splitlines():
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            approved_images[key] = value

    runtime_env = parse_env(env_file)
    for key in required_image_keys(args.role):
        if runtime_env.get(key) != approved_images.get(key):
            print(f"FAIL: {key} does not match the approved rollback bundle", file=sys.stderr)
            return 2

    compose = repo / "deploy/oracle" / (
        "docker-compose.api.yml" if args.role == "api" else "docker-compose.workers.yml"
    )
    run(
        [
            sys.executable,
            str(repo / "scripts/oracle_deploy_preflight.py"),
            args.role,
            "--env-file",
            str(env_file),
            "--compose",
        ],
        cwd=repo,
    )

    base = ["docker", "compose", "--env-file", str(env_file), "-f", str(compose)]
    run(base + ["pull"], cwd=repo)
    run(base + ["up", "-d", "--remove-orphans"], cwd=repo)
    run(base + ["ps"], cwd=repo)

    if args.evidence_out:
        evidence = {
            "schema": "genithm-v1-rollback-evidence/1",
            "role": args.role,
            "source_sha": args.expected_source_sha,
            "release_bundle_sha256": hashlib.sha256(bundle_file.read_bytes()).hexdigest(),
            "completed_at": datetime.now(timezone.utc).isoformat(),
            "result": "rollback_command_sequence_completed",
        }
        args.evidence_out.parent.mkdir(parents=True, exist_ok=True)
        args.evidence_out.write_text(json.dumps(evidence, indent=2, sort_keys=True) + "\n", encoding="utf-8")

    print(f"PASS: {args.role} rollback completed using approved digest-pinned release {args.expected_source_sha}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
