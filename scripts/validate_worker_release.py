from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path
from typing import Any

SOURCE_REVISION = re.compile(r"^[0-9a-f]{40}$")
DIGEST_REF = re.compile(r"^[a-z0-9][a-z0-9._/-]*@sha256:[0-9a-f]{64}$")
EXPECTED_WORKERS = ("sequence", "source", "blast", "scientific", "audit", "ai")
EXPECTED_DEPLOYMENTS = tuple(f"{worker}-worker" for worker in EXPECTED_WORKERS)


def validate_release(
    manifest: dict[str, Any],
    deployment: bytes,
    *,
    expected_revision: str | None = None,
) -> list[str]:
    errors: list[str] = []

    if manifest.get("schema_version") != "genithm-worker-release/1":
        errors.append("unexpected release schema version")

    source = manifest.get("source")
    revision = source.get("commit_sha") if isinstance(source, dict) else None
    if not isinstance(revision, str) or not SOURCE_REVISION.fullmatch(revision):
        errors.append("release source commit is not a full lowercase SHA")
    elif expected_revision is not None and revision != expected_revision:
        errors.append("release source commit does not match expected revision")

    deployment_info = manifest.get("deployment")
    expected_hash = deployment_info.get("sha256") if isinstance(deployment_info, dict) else None
    actual_hash = hashlib.sha256(deployment).hexdigest()
    if expected_hash != actual_hash:
        errors.append("deployment manifest SHA-256 mismatch")

    workers = manifest.get("workers")
    if not isinstance(workers, list):
        errors.append("workers must be a list")
        workers = []

    worker_names: list[str] = []
    deployment_names: list[str] = []
    for item in workers:
        if not isinstance(item, dict):
            errors.append("worker entry must be an object")
            continue
        worker = item.get("worker")
        deployment_name = item.get("deployment")
        image = item.get("image")
        worker_names.append(worker if isinstance(worker, str) else "")
        deployment_names.append(deployment_name if isinstance(deployment_name, str) else "")
        if not isinstance(image, str) or not DIGEST_REF.fullmatch(image):
            errors.append(f"{worker or 'unknown'} image is not digest-pinned")

    if tuple(worker_names) != EXPECTED_WORKERS:
        errors.append("release does not contain the exact six workers in canonical order")
    if tuple(deployment_names) != EXPECTED_DEPLOYMENTS:
        errors.append("release deployment names do not match the six expected deployments")

    text = deployment.decode("utf-8", errors="replace")
    if text.count("kind: Deployment") != 6:
        errors.append("rendered manifest does not contain exactly six Deployments")
    if text.count("@sha256:") != 6:
        errors.append("rendered manifest does not contain exactly six digest-pinned images")
    if "kind: Secret" in text:
        errors.append("rendered manifest must not embed a Kubernetes Secret")
    for placeholder in (
        "GENITHM_SEQUENCE_WORKER_IMAGE",
        "GENITHM_SOURCE_WORKER_IMAGE",
        "GENITHM_BLAST_WORKER_IMAGE",
        "GENITHM_SCIENTIFIC_WORKER_IMAGE",
        "GENITHM_AUDIT_WORKER_IMAGE",
        "GENITHM_AI_WORKER_IMAGE",
    ):
        if placeholder in text:
            errors.append(f"unrendered image placeholder remains: {placeholder}")

    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate a Genithm continuous-worker release artifact")
    parser.add_argument("--release-manifest", required=True, type=Path)
    parser.add_argument("--deployment-manifest", required=True, type=Path)
    parser.add_argument("--expected-revision")
    args = parser.parse_args()

    if args.expected_revision is not None and not SOURCE_REVISION.fullmatch(args.expected_revision):
        print("worker release validation failed: expected revision must be a full lowercase SHA", file=sys.stderr)
        return 2

    try:
        manifest = json.loads(args.release_manifest.read_text(encoding="utf-8"))
        deployment = args.deployment_manifest.read_bytes()
    except (OSError, json.JSONDecodeError) as exc:
        print(f"worker release validation failed: {exc}", file=sys.stderr)
        return 2

    if not isinstance(manifest, dict):
        print("worker release validation failed: release manifest must be a JSON object", file=sys.stderr)
        return 2

    errors = validate_release(manifest, deployment, expected_revision=args.expected_revision)
    if errors:
        for error in errors:
            print(f"worker release validation failed: {error}", file=sys.stderr)
        return 2

    print("worker release validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
