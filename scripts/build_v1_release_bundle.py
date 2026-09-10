from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

SOURCE_REVISION = re.compile(r"^[0-9a-f]{40}$")
IMAGE_REFERENCE = re.compile(r"^[a-z0-9.-]+(?:/[a-z0-9._/-]+)+@sha256:[0-9a-f]{64}$", re.IGNORECASE)
EXPECTED_WORKERS = ("sequence", "source", "blast", "scientific", "audit", "ai")
EXPECTED_PLATFORMS = ["linux/amd64", "linux/arm64"]


def _load(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"{path} must contain a JSON object")
    return payload


def build_bundle(candidate: dict[str, Any], api: dict[str, Any], workers: dict[str, Any]) -> dict[str, Any]:
    if candidate.get("schema_version") != "genithm-v1-candidate/1":
        raise ValueError("invalid V1 candidate schema")
    if candidate.get("release_target") != "v1.0.0":
        raise ValueError("V1 candidate release_target must be v1.0.0")
    if candidate.get("stage") != "deployment_candidate":
        raise ValueError("V1 candidate stage must be deployment_candidate")

    repository = candidate.get("repository")
    if not isinstance(repository, str) or "/" not in repository:
        raise ValueError("candidate repository must use owner/name form")
    if candidate.get("platforms") != EXPECTED_PLATFORMS:
        raise ValueError("candidate must declare linux/amd64 and linux/arm64")

    revision = api.get("source_revision")
    if not isinstance(revision, str) or SOURCE_REVISION.fullmatch(revision) is None:
        raise ValueError("API release has invalid source revision")
    if api.get("repository") != repository:
        raise ValueError("API release repository does not match candidate")
    if api.get("platforms") != EXPECTED_PLATFORMS:
        raise ValueError("API release platforms do not match V1 candidate")
    api_image = api.get("image")
    if not isinstance(api_image, str) or IMAGE_REFERENCE.fullmatch(api_image) is None:
        raise ValueError("API image must be digest pinned")

    source = workers.get("source")
    if not isinstance(source, dict):
        raise ValueError("worker release source is missing")
    if source.get("repository") != repository:
        raise ValueError("worker release repository does not match candidate")
    if source.get("commit_sha") != revision:
        raise ValueError("API and worker release revisions do not match")
    if workers.get("platforms") != EXPECTED_PLATFORMS:
        raise ValueError("worker release platforms do not match V1 candidate")

    records = workers.get("workers")
    if not isinstance(records, list) or len(records) != len(EXPECTED_WORKERS):
        raise ValueError("worker release must contain exactly six workers")
    worker_images: dict[str, str] = {}
    for record in records:
        if not isinstance(record, dict):
            raise ValueError("worker release contains an invalid worker record")
        name = record.get("worker")
        image = record.get("image")
        if name not in EXPECTED_WORKERS or name in worker_images:
            raise ValueError("worker release contains missing, duplicate, or unknown workers")
        if not isinstance(image, str) or IMAGE_REFERENCE.fullmatch(image) is None:
            raise ValueError(f"{name} worker image must be digest pinned")
        worker_images[name] = image
    if set(worker_images) != set(EXPECTED_WORKERS):
        raise ValueError("worker release does not contain the six expected workers")

    cloudflared = candidate.get("cloudflared")
    if not isinstance(cloudflared, dict):
        raise ValueError("candidate cloudflared contract is missing")
    cloudflared_image = cloudflared.get("image")
    if not isinstance(cloudflared_image, str) or IMAGE_REFERENCE.fullmatch(cloudflared_image) is None:
        raise ValueError("cloudflared image must be digest pinned")

    runtime = candidate.get("runtime_contract")
    if runtime != {"expected_workers": 6, "expected_queues": 9}:
        raise ValueError("candidate runtime contract must require six workers and nine queues")

    return {
        "schema_version": "genithm-v1-release/1",
        "release_target": "v1.0.0",
        "stage": "deployment_candidate",
        "repository": repository,
        "source_revision": revision,
        "platforms": EXPECTED_PLATFORMS,
        "images": {
            "api": api_image,
            "cloudflared": cloudflared_image,
            "workers": {name: worker_images[name] for name in EXPECTED_WORKERS},
        },
        "runtime_contract": runtime,
        "verification": {
            "production_smoke_required": True,
            "production_scientific_e2e_required": True,
            "tag_allowed_only_after_live_gates": True,
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Build the immutable Genithm V1 production deployment candidate bundle")
    parser.add_argument("--candidate", required=True, type=Path)
    parser.add_argument("--api-release", required=True, type=Path)
    parser.add_argument("--worker-release", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()

    try:
        bundle = build_bundle(_load(args.candidate), _load(args.api_release), _load(args.worker_release))
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        print(f"V1 release bundle failed: {exc}", file=sys.stderr)
        return 2

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(bundle, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
