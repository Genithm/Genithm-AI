from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path
from typing import Any

SOURCE_REVISION = re.compile(r"^[0-9a-f]{40}$")
REPOSITORY = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
IMAGE_REFERENCE = re.compile(
    r"^(?P<repository>[a-z0-9][a-z0-9._/-]*(?::[A-Za-z0-9._-]+)?)@(?P<digest>sha256:[0-9a-f]{64})$"
)

WORKER_ORDER = ("sequence", "source", "blast", "scientific", "audit", "ai")
WORKERS: dict[str, dict[str, Any]] = {
    "sequence": {
        "deployment": "sequence-worker",
        "context": "apps/sequence-worker",
        "responsibilities": ["FASTA validation", "sequence statistics"],
    },
    "source": {
        "deployment": "source-worker",
        "context": "apps/source-worker",
        "responsibilities": ["live NCBI sequence retrieval", "protein annotation source adapters"],
    },
    "blast": {
        "deployment": "blast-worker",
        "context": "apps/blast-worker",
        "responsibilities": ["NCBI remote BLAST submission", "BLAST polling", "BLAST result capture"],
    },
    "scientific": {
        "deployment": "scientific-worker",
        "context": "apps/scientific-worker",
        "responsibilities": [
            "pairwise alignment",
            "multiple sequence alignment",
            "phylogeny",
            "protein properties",
        ],
    },
    "audit": {
        "deployment": "audit-worker",
        "context": "apps/audit-worker",
        "responsibilities": ["audit checkpoint signing"],
    },
    "ai": {
        "deployment": "ai-worker",
        "context": "apps/ai-worker",
        "responsibilities": [
            "AI planning",
            "evidence-grounded interpretation",
            "frozen-evidence follow-up",
        ],
    },
}


def parse_image_args(values: list[str]) -> dict[str, str]:
    images: dict[str, str] = {}
    for value in values:
        worker, separator, image = value.partition("=")
        if not separator or not worker or not image:
            raise ValueError("--image entries must use worker=registry/image@sha256:digest")
        if worker in images:
            raise ValueError(f"duplicate worker image: {worker}")
        images[worker] = image
    return images


def _validate_images(images: dict[str, str]) -> dict[str, tuple[str, str]]:
    missing = sorted(set(WORKER_ORDER) - set(images))
    extra = sorted(set(images) - set(WORKER_ORDER))
    if missing:
        raise ValueError(f"missing worker images: {', '.join(missing)}")
    if extra:
        raise ValueError(f"unknown worker images: {', '.join(extra)}")

    parsed: dict[str, tuple[str, str]] = {}
    for worker in WORKER_ORDER:
        image = images[worker]
        match = IMAGE_REFERENCE.fullmatch(image)
        if match is None:
            raise ValueError(f"{worker} image must be a lowercase registry reference pinned by sha256 digest")
        parsed[worker] = (match.group("repository"), match.group("digest"))
    return parsed


def build_manifest(
    *,
    repository: str,
    source_revision: str,
    deployment_manifest: bytes,
    images: dict[str, str],
) -> dict[str, Any]:
    if not REPOSITORY.fullmatch(repository):
        raise ValueError("repository must use owner/name form")
    if not SOURCE_REVISION.fullmatch(source_revision):
        raise ValueError("source revision must be a full lowercase 40-character Git commit SHA")
    if not deployment_manifest:
        raise ValueError("deployment manifest must not be empty")

    parsed = _validate_images(images)
    deployment_sha256 = hashlib.sha256(deployment_manifest).hexdigest()

    workers: list[dict[str, Any]] = []
    for worker in WORKER_ORDER:
        image_repository, digest = parsed[worker]
        contract = WORKERS[worker]
        workers.append(
            {
                "worker": worker,
                "deployment": contract["deployment"],
                "context": contract["context"],
                "image": images[worker],
                "image_repository": image_repository,
                "digest": digest,
                "responsibilities": contract["responsibilities"],
            }
        )

    return {
        "schema_version": "genithm-worker-release/1",
        "release_id": f"workers-{source_revision[:12]}",
        "source": {
            "repository": repository,
            "commit_sha": source_revision,
        },
        "platforms": ["linux/amd64"],
        "supply_chain": {
            "image_reference_policy": "sha256-digest-only",
            "provenance_attestation": "buildkit-mode-max",
            "sbom_attestation": "spdx",
        },
        "deployment": {
            "namespace": "genithm-workers",
            "manifest_file": "genithm-workers.yaml",
            "sha256": deployment_sha256,
        },
        "workers": workers,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Build Genithm's immutable continuous-worker release manifest")
    parser.add_argument("--repository", required=True, help="GitHub repository in owner/name form")
    parser.add_argument("--source-revision", required=True, help="Full tested Git commit SHA")
    parser.add_argument("--deployment-manifest", required=True, type=Path)
    parser.add_argument(
        "--image",
        action="append",
        default=[],
        help="Pinned image reference, e.g. sequence=ghcr.io/genithm/genithm-sequence-worker@sha256:<digest>",
    )
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()

    try:
        deployment_manifest = args.deployment_manifest.read_bytes()
        manifest = build_manifest(
            repository=args.repository,
            source_revision=args.source_revision,
            deployment_manifest=deployment_manifest,
            images=parse_image_args(args.image),
        )
    except (OSError, ValueError) as exc:
        print(f"worker release manifest failed: {exc}", file=sys.stderr)
        return 2

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
