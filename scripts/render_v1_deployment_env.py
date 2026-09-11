from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

IMAGE_REFERENCE = re.compile(r"^[a-z0-9.-]+(?:/[a-z0-9._/-]+)+@sha256:[0-9a-f]{64}$", re.IGNORECASE)
EXPECTED_WORKERS = ("sequence", "source", "blast", "scientific", "audit", "ai")


def _load(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("release bundle must contain a JSON object")
    return payload


def _require_image(value: Any, label: str) -> str:
    if not isinstance(value, str) or IMAGE_REFERENCE.fullmatch(value) is None:
        raise ValueError(f"{label} must be a digest-pinned image reference")
    return value


def render_env(bundle: dict[str, Any]) -> str:
    if bundle.get("schema_version") != "genithm-v1-release/1":
        raise ValueError("invalid V1 release bundle schema")
    if bundle.get("release_target") != "v1.0.0":
        raise ValueError("release bundle target must be v1.0.0")
    if bundle.get("stage") != "deployment_candidate":
        raise ValueError("release bundle must be a deployment candidate")

    images = bundle.get("images")
    if not isinstance(images, dict):
        raise ValueError("release bundle images are missing")

    api = _require_image(images.get("api"), "API image")
    cloudflared = _require_image(images.get("cloudflared"), "cloudflared image")
    workers = images.get("workers")
    if not isinstance(workers, dict):
        raise ValueError("worker images are missing")
    if set(workers) != set(EXPECTED_WORKERS):
        raise ValueError("release bundle must contain exactly the six expected workers")

    worker_vars = {
        "sequence": "GENITHM_SEQUENCE_WORKER_IMAGE",
        "source": "GENITHM_SOURCE_WORKER_IMAGE",
        "blast": "GENITHM_BLAST_WORKER_IMAGE",
        "scientific": "GENITHM_SCIENTIFIC_WORKER_IMAGE",
        "audit": "GENITHM_AUDIT_WORKER_IMAGE",
        "ai": "GENITHM_AI_WORKER_IMAGE",
    }

    lines = [
        "# Generated from an approved Genithm V1 release bundle.",
        "# Contains image references only; never put runtime secrets in this file.",
        f"GENITHM_API_IMAGE={api}",
        f"GENITHM_CLOUDFLARED_IMAGE={cloudflared}",
    ]
    for worker in EXPECTED_WORKERS:
        image = _require_image(workers.get(worker), f"{worker} worker image")
        lines.append(f"{worker_vars[worker]}={image}")
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description="Render digest-pinned Oracle deployment image variables from a V1 release bundle")
    parser.add_argument("--bundle", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()

    try:
        rendered = render_env(_load(args.bundle))
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        print(f"deployment handoff failed: {exc}", file=sys.stderr)
        return 2

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(rendered, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
