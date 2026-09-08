from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from build_worker_release_manifest import WORKER_ORDER, build_manifest, parse_image_args

DIGEST = "a" * 64
IMAGES = {worker: f"ghcr.io/genithm/genithm-{worker}-worker@sha256:{DIGEST}" for worker in WORKER_ORDER}
IMAGES["scientific"] = f"ghcr.io/genithm/genithm-scientific-worker@sha256:{DIGEST}"


class WorkerReleaseManifestTests(unittest.TestCase):
    def test_builds_bounded_immutable_manifest(self) -> None:
        deployment = b"apiVersion: v1\nkind: Namespace\n"
        source_revision = "b" * 40
        manifest = build_manifest(
            repository="Genithm/Genithm-AI",
            source_revision=source_revision,
            deployment_manifest=deployment,
            images=IMAGES,
        )
        self.assertEqual(manifest["schema_version"], "genithm-worker-release/1")
        self.assertEqual(manifest["source"]["commit_sha"], source_revision)
        self.assertEqual(manifest["deployment"]["sha256"], hashlib.sha256(deployment).hexdigest())
        self.assertEqual([item["worker"] for item in manifest["workers"]], list(WORKER_ORDER))
        self.assertTrue(all("@sha256:" in item["image"] for item in manifest["workers"]))
        self.assertNotIn("secret", json.dumps(manifest).lower())

    def test_rejects_mutable_image(self) -> None:
        images = dict(IMAGES)
        images["ai"] = "ghcr.io/genithm/genithm-ai-worker:latest"
        with self.assertRaisesRegex(ValueError, "pinned by sha256"):
            build_manifest(
                repository="Genithm/Genithm-AI",
                source_revision="b" * 40,
                deployment_manifest=b"manifest",
                images=images,
            )

    def test_rejects_missing_worker(self) -> None:
        images = dict(IMAGES)
        del images["audit"]
        with self.assertRaisesRegex(ValueError, "missing worker images: audit"):
            build_manifest(
                repository="Genithm/Genithm-AI",
                source_revision="b" * 40,
                deployment_manifest=b"manifest",
                images=images,
            )

    def test_rejects_non_full_revision(self) -> None:
        with self.assertRaisesRegex(ValueError, "full lowercase 40-character"):
            build_manifest(
                repository="Genithm/Genithm-AI",
                source_revision="abc123",
                deployment_manifest=b"manifest",
                images=IMAGES,
            )

    def test_parse_image_args_rejects_duplicate(self) -> None:
        value = f"sequence=ghcr.io/genithm/sequence@sha256:{DIGEST}"
        with self.assertRaisesRegex(ValueError, "duplicate worker image"):
            parse_image_args([value, value])


if __name__ == "__main__":
    unittest.main()
