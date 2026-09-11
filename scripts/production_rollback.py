from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
from pathlib import Path

IMAGE_LINE = re.compile(r"^(GENITHM_[A-Z0-9_]+_IMAGE)=(.+@sha256:[0-9a-f]{64})$")


def run(cmd: list[str], *, cwd: Path) -> None:
    print("+", " ".join(cmd))
    proc = subprocess.run(cmd, cwd=cwd, check=False)
    if proc.returncode != 0:
        raise SystemExit(proc.returncode)


def load_image_pins(env_file: Path) -> dict[str, str]:
    pins: dict[str, str] = {}
    for raw in env_file.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        match = IMAGE_LINE.match(line)
        if match:
            pins[match.group(1)] = match.group(2)
    return pins


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Rollback Genithm V1 Oracle services to a previously approved digest-pinned environment file."
    )
    parser.add_argument("role", choices=("api", "workers"))
    parser.add_argument("--env-file", required=True, type=Path, help="Previously approved runtime env file containing immutable image pins.")
    parser.add_argument(
        "--expected-source-sha",
        help="Optional release source SHA recorded during the prior approved deployment; written to rollback evidence only.",
    )
    parser.add_argument("--evidence-out", type=Path, help="Optional path for secretless rollback evidence.")
    parser.add_argument("--pull-only", action="store_true")
    args = parser.parse_args()

    repo = Path(__file__).resolve().parents[1]
    compose = repo / "deploy/oracle" / ("docker-compose.api.yml" if args.role == "api" else "docker-compose.workers.yml")
    env_file = args.env_file.resolve()

    if not env_file.is_file():
        print(f"FAIL: rollback env file not found: {env_file}", file=sys.stderr)
        return 2

    pins = load_image_pins(env_file)
    required = {"GENITHM_API_IMAGE", "CLOUDFLARED_IMAGE"} if args.role == "api" else {
        "GENITHM_SEQUENCE_WORKER_IMAGE",
        "GENITHM_SOURCE_WORKER_IMAGE",
        "GENITHM_BLAST_WORKER_IMAGE",
        "GENITHM_SCIENTIFIC_WORKER_IMAGE",
        "GENITHM_AUDIT_WORKER_IMAGE",
        "GENITHM_AI_WORKER_IMAGE",
    }
    missing = sorted(required - pins.keys())
    if missing:
        print("FAIL: rollback env is missing immutable image pins: " + ", ".join(missing), file=sys.stderr)
        return 2

    run([sys.executable, str(repo / "scripts/oracle_deploy_preflight.py"), args.role, "--env-file", str(env_file), "--compose"], cwd=repo)
    base = ["docker", "compose", "--env-file", str(env_file), "-f", str(compose)]
    run(base + ["pull"], cwd=repo)
    if not args.pull_only:
        run(base + ["up", "-d", "--remove-orphans"], cwd=repo)
        run(base + ["ps"], cwd=repo)

    if args.evidence_out:
        out = args.evidence_out.resolve()
        out.parent.mkdir(parents=True, exist_ok=True)
        lines = [
            "schema=genithm-v1-rollback-evidence/1",
            f"role={args.role}",
            f"source_sha={args.expected_source_sha or 'unknown'}",
            f"image_count={len(required)}",
            f"action={'pull-only' if args.pull_only else 'rollback'}",
        ]
        out.write_text("\n".join(lines) + "\n", encoding="utf-8")
        os.chmod(out, 0o600)

    print(f"PASS: {args.role} rollback command sequence completed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
