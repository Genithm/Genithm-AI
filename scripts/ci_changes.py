from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

WORKERS = ("sequence", "source", "blast", "audit", "scientific", "ai")
WORKER_DIRS = {worker: f"apps/{worker}-worker/" for worker in WORKERS}

FULL_CI_TRIGGERS = {
    ".github/workflows/ci.yml",
    "scripts/ci_changes.py",
    "scripts/test_ci_changes.py",
}

CHEAP_PREFIXES = ("docs/", "supabase/")
CHEAP_EXACT = {
    ".env.example",
    ".gitignore",
    "README.md",
    "SECURITY.md",
    ".github/dependabot.yml",
    "scripts/security_policy.py",
    "scripts/production_smoke.py",
    ".github/workflows/production-smoke.yml",
    ".github/workflows/worker-production-preflight.yml",
}

KNOWN_WORKFLOW_EXACT = {
    ".github/workflows/api-release.yml",
    ".github/workflows/worker-image.yml",
    ".github/workflows/worker-release.yml",
    ".github/workflows/worker-deployment-contract.yml",
}

KNOWN_DEPLOY_PREFIXES = ("deploy/",)
KNOWN_RELEASE_SCRIPTS = {
    "scripts/render_worker_deployment.py",
    "scripts/build_worker_release_manifest.py",
    "scripts/validate_worker_release.py",
    "scripts/test_worker_deployment.py",
    "scripts/test_worker_release_manifest.py",
    "scripts/test_validate_worker_release.py",
}

RELEASE_SHARED_PATHS = {
    "deploy/kubernetes/workers.yaml",
    "scripts/render_worker_deployment.py",
    "scripts/build_worker_release_manifest.py",
    "scripts/validate_worker_release.py",
}

OUTPUT_KEYS = (
    "web",
    "api",
    *(f"{worker}_worker" for worker in WORKERS),
    *(f"{worker}_image" for worker in WORKERS),
    "audit_web",
    "audit_api",
    *(f"audit_{worker}" for worker in WORKERS),
    "dependency_audit",
    "release_required",
    "full_ci",
)


def _normalize_paths(lines: list[str]) -> list[str]:
    normalized: list[str] = []
    for raw in lines:
        path = raw.strip().replace("\\", "/")
        if path.startswith("./"):
            path = path[2:]
        if path:
            normalized.append(path)
    return sorted(set(normalized))


def _is_known(path: str) -> bool:
    if path in FULL_CI_TRIGGERS or path in CHEAP_EXACT or path in KNOWN_WORKFLOW_EXACT or path in KNOWN_RELEASE_SCRIPTS:
        return True
    if path.startswith(CHEAP_PREFIXES) or path.startswith(KNOWN_DEPLOY_PREFIXES):
        return True
    if path.startswith("apps/web/") or path.startswith("apps/api/"):
        return True
    if any(path.startswith(prefix) for prefix in WORKER_DIRS.values()):
        return True
    return False


def _worker_runtime_changed(path: str, worker: str) -> bool:
    prefix = WORKER_DIRS[worker]
    if not path.startswith(prefix):
        return False
    relative = path[len(prefix):]
    return not relative.startswith("tests/")


def classify(paths: list[str]) -> dict[str, bool]:
    paths = _normalize_paths(paths)
    unknown = [path for path in paths if not _is_known(path)]
    full_ci = bool(unknown) or any(path in FULL_CI_TRIGGERS for path in paths)

    result = {key: False for key in OUTPUT_KEYS}
    result["full_ci"] = full_ci

    result["web"] = any(path.startswith("apps/web/") for path in paths)
    result["api"] = any(path.startswith("apps/api/") for path in paths)

    worker_image_workflow_changed = ".github/workflows/worker-image.yml" in paths
    for worker in WORKERS:
        prefix = WORKER_DIRS[worker]
        result[f"{worker}_worker"] = any(path.startswith(prefix) for path in paths)
        result[f"{worker}_image"] = worker_image_workflow_changed or any(
            _worker_runtime_changed(path, worker) for path in paths
        )

    result["audit_web"] = any(
        path in {"apps/web/package.json", "apps/web/package-lock.json"} for path in paths
    )
    result["audit_api"] = "apps/api/pyproject.toml" in paths
    for worker in WORKERS:
        result[f"audit_{worker}"] = f"apps/{worker}-worker/pyproject.toml" in paths

    if full_ci:
        result["web"] = True
        result["api"] = True
        for worker in WORKERS:
            result[f"{worker}_worker"] = True
        result["audit_web"] = True
        result["audit_api"] = True
        for worker in WORKERS:
            result[f"audit_{worker}"] = True

        # Unknown areas are conservative: validate every image too. Known CI-routing
        # changes run full code/security validation without paying for six unrelated
        # Docker builds solely because the routing implementation changed.
        if unknown:
            for worker in WORKERS:
                result[f"{worker}_image"] = True

    result["dependency_audit"] = any(
        result[key]
        for key in ("audit_web", "audit_api", *(f"audit_{worker}" for worker in WORKERS))
    )
    result["release_required"] = bool(unknown) or any(result[f"{worker}_image"] for worker in WORKERS) or any(
        path in RELEASE_SHARED_PATHS for path in paths
    )
    return result


def _write_github_output(result: dict[str, bool], destination: Path) -> None:
    with destination.open("a", encoding="utf-8") as handle:
        for key in OUTPUT_KEYS:
            handle.write(f"{key}={'true' if result[key] else 'false'}\n")


def main() -> int:
    parser = argparse.ArgumentParser(description="Classify changed repository paths for targeted CI.")
    parser.add_argument("paths", nargs="*", help="Changed paths. If omitted, newline-delimited paths are read from stdin.")
    parser.add_argument("--github-output", type=Path, default=None, help="Append key/value outputs to this GitHub Actions output file.")
    args = parser.parse_args()

    paths = args.paths if args.paths else sys.stdin.read().splitlines()
    result = classify(paths)

    destination = args.github_output
    if destination is None and os.getenv("GITHUB_OUTPUT"):
        destination = Path(os.environ["GITHUB_OUTPUT"])

    if destination is not None:
        _write_github_output(result, destination)
    else:
        for key in OUTPUT_KEYS:
            print(f"{key}={'true' if result[key] else 'false'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
