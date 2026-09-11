from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path


def run(cmd: list[str], *, cwd: Path) -> None:
    print("+", " ".join(cmd))
    proc = subprocess.run(cmd, cwd=cwd, check=False)
    if proc.returncode != 0:
        raise SystemExit(proc.returncode)


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the Genithm V1 production deployment sequence on a prepared host.")
    parser.add_argument("role", choices=("api", "workers"))
    parser.add_argument("--env-file", required=True, type=Path)
    parser.add_argument("--pull-only", action="store_true")
    args = parser.parse_args()

    repo = Path(__file__).resolve().parents[1]
    compose = repo / "deploy/oracle" / ("docker-compose.api.yml" if args.role == "api" else "docker-compose.workers.yml")
    env_file = args.env_file.resolve()

    if not env_file.is_file():
        print(f"FAIL: env file not found: {env_file}", file=sys.stderr)
        return 2

    run([sys.executable, str(repo / "scripts/oracle_deploy_preflight.py"), args.role, "--env-file", str(env_file), "--compose"], cwd=repo)
    base = ["docker", "compose", "--env-file", str(env_file), "-f", str(compose)]
    run(base + ["pull"], cwd=repo)
    if args.pull_only:
        print(f"PASS: {args.role} images pulled after successful preflight")
        return 0
    run(base + ["up", "-d", "--remove-orphans"], cwd=repo)
    run(base + ["ps"], cwd=repo)
    print(f"PASS: {args.role} deployment command sequence completed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
