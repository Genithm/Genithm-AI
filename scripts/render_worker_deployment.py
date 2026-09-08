from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TEMPLATE = ROOT / "deploy" / "kubernetes" / "workers.yaml"
IMAGE_DIGEST = re.compile(r"^[a-z0-9][a-z0-9._/-]*(?::[A-Za-z0-9._-]+)?@sha256:[0-9a-f]{64}$")

PLACEHOLDERS = {
    "sequence": "GENITHM_SEQUENCE_WORKER_IMAGE",
    "source": "GENITHM_SOURCE_WORKER_IMAGE",
    "blast": "GENITHM_BLAST_WORKER_IMAGE",
    "scientific": "GENITHM_SCIENTIFIC_WORKER_IMAGE",
    "audit": "GENITHM_AUDIT_WORKER_IMAGE",
    "ai": "GENITHM_AI_WORKER_IMAGE",
}


def render(images: dict[str, str], template: str | None = None) -> str:
    missing = sorted(set(PLACEHOLDERS) - set(images))
    extra = sorted(set(images) - set(PLACEHOLDERS))
    if missing:
        raise ValueError(f"missing worker images: {', '.join(missing)}")
    if extra:
        raise ValueError(f"unknown worker images: {', '.join(extra)}")

    for worker, image in images.items():
        if not IMAGE_DIGEST.fullmatch(image):
            raise ValueError(f"{worker} image must be a registry reference pinned by sha256 digest")

    output = TEMPLATE.read_text(encoding="utf-8") if template is None else template
    for worker, placeholder in PLACEHOLDERS.items():
        output = output.replace(placeholder, images[worker])

    leftovers = sorted(set(re.findall(r"GENITHM_[A-Z_]+_WORKER_IMAGE", output)))
    if leftovers:
        raise ValueError(f"unresolved image placeholders: {', '.join(leftovers)}")
    return output


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


def main() -> int:
    parser = argparse.ArgumentParser(description="Render Genithm continuous worker Kubernetes deployments")
    parser.add_argument(
        "--image",
        action="append",
        default=[],
        help="Pinned image reference, e.g. sequence=ghcr.io/genithm/sequence@sha256:<64 hex>",
    )
    parser.add_argument("--output", type=Path, help="Write rendered manifest to this path; stdout when omitted")
    args = parser.parse_args()
    try:
        rendered = render(parse_image_args(args.image))
    except ValueError as exc:
        print(f"worker deployment render failed: {exc}", file=sys.stderr)
        return 2

    if args.output:
        args.output.write_text(rendered, encoding="utf-8")
    else:
        sys.stdout.write(rendered)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
