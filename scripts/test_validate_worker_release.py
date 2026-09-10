from __future__ import annotations

import hashlib
import unittest

from validate_worker_release import EXPECTED_PLATFORMS, EXPECTED_WORKERS, validate_release

DIGEST = "a" * 64
REVISION = "b" * 40


def fixture() -> tuple[dict[str, object], bytes]:
    deployment = "\n".join(
        [
            "apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: %s-worker\nspec:\n  template:\n    spec:\n      containers:\n        - image: ghcr.io/genithm/genithm-%s-worker@sha256:%s"
            % (worker, worker, DIGEST)
            for worker in EXPECTED_WORKERS
        ]
    ).encode()
    manifest = {
        "schema_version": "genithm-worker-release/1",
        "source": {"repository": "Genithm/Genithm-AI", "commit_sha": REVISION},
        "platforms": list(EXPECTED_PLATFORMS),
        "deployment": {"sha256": hashlib.sha256(deployment).hexdigest()},
        "workers": [
            {
                "worker": worker,
                "deployment": f"{worker}-worker",
                "image": f"ghcr.io/genithm/genithm-{worker}-worker@sha256:{DIGEST}",
            }
            for worker in EXPECTED_WORKERS
        ],
    }
    return manifest, deployment


class ValidateWorkerReleaseTests(unittest.TestCase):
    def test_accepts_exact_release(self) -> None:
        manifest, deployment = fixture()
        self.assertEqual(validate_release(manifest, deployment, expected_revision=REVISION), [])

    def test_rejects_missing_arm64_platform(self) -> None:
        manifest, deployment = fixture()
        manifest["platforms"] = ["linux/amd64"]
        errors = validate_release(manifest, deployment)
        self.assertIn("release platforms must declare linux/amd64 and linux/arm64", errors)

    def test_rejects_hash_mismatch(self) -> None:
        manifest, deployment = fixture()
        manifest["deployment"] = {"sha256": "0" * 64}
        errors = validate_release(manifest, deployment)
        self.assertIn("deployment manifest SHA-256 mismatch", errors)

    def test_rejects_mutable_image(self) -> None:
        manifest, deployment = fixture()
        workers = manifest["workers"]
        assert isinstance(workers, list)
        workers[0]["image"] = "ghcr.io/genithm/genithm-sequence-worker:latest"
        errors = validate_release(manifest, deployment)
        self.assertIn("sequence image is not digest-pinned", errors)

    def test_rejects_embedded_secret(self) -> None:
        manifest, deployment = fixture()
        deployment += b"\n---\napiVersion: v1\nkind: Secret\n"
        manifest["deployment"] = {"sha256": hashlib.sha256(deployment).hexdigest()}
        errors = validate_release(manifest, deployment)
        self.assertIn("rendered manifest must not embed a Kubernetes Secret", errors)


if __name__ == "__main__":
    unittest.main()
