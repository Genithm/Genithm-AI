from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "render_worker_deployment", ROOT / "scripts" / "render_worker_deployment.py"
)
assert SPEC and SPEC.loader
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)

TEMPLATE = (ROOT / "deploy" / "kubernetes" / "workers.yaml").read_text(encoding="utf-8")
WORKERS = ("sequence", "source", "blast", "scientific", "audit", "ai")


class WorkerDeploymentContractTests(unittest.TestCase):
    def test_template_has_exact_worker_deployments(self) -> None:
        for worker in WORKERS:
            self.assertIn(f"name: {worker}-worker", TEMPLATE)
        self.assertEqual(TEMPLATE.count("kind: Deployment"), len(WORKERS))

    def test_hardening_contract_is_present(self) -> None:
        self.assertGreaterEqual(TEMPLATE.count("automountServiceAccountToken: false"), len(WORKERS))
        self.assertIn("allowPrivilegeEscalation: false", TEMPLATE)
        self.assertIn("readOnlyRootFilesystem: true", TEMPLATE)
        self.assertIn("runAsNonRoot: true", TEMPLATE)
        self.assertIn("capabilities: {drop: [ALL]}", TEMPLATE)
        self.assertIn("seccompProfile: {type: RuntimeDefault}", TEMPLATE)
        self.assertIn("workers-no-ingress", TEMPLATE)
        self.assertIn("workers-https-egress", TEMPLATE)

    def test_shared_secret_is_not_embedded(self) -> None:
        self.assertNotIn("sb_secret_", TEMPLATE)
        self.assertNotIn("sk-", TEMPLATE)
        self.assertIn("secretKeyRef", TEMPLATE)
        self.assertNotIn("kind: Secret", TEMPLATE)

    def test_renderer_requires_all_digest_pinned_images(self) -> None:
        digest = "a" * 64
        images = {worker: f"ghcr.io/genithm/{worker}-worker@sha256:{digest}" for worker in WORKERS}
        rendered = module.render(images, TEMPLATE)
        self.assertNotIn("GENITHM_SEQUENCE_WORKER_IMAGE", rendered)
        self.assertEqual(rendered.count("@sha256:"), len(WORKERS))

    def test_renderer_rejects_mutable_tag(self) -> None:
        digest = "b" * 64
        images = {worker: f"ghcr.io/genithm/{worker}-worker@sha256:{digest}" for worker in WORKERS}
        images["ai"] = "ghcr.io/genithm/ai-worker:latest"
        with self.assertRaises(ValueError):
            module.render(images, TEMPLATE)

    def test_renderer_rejects_missing_image(self) -> None:
        digest = "c" * 64
        images = {worker: f"ghcr.io/genithm/{worker}-worker@sha256:{digest}" for worker in WORKERS if worker != "audit"}
        with self.assertRaises(ValueError):
            module.render(images, TEMPLATE)


if __name__ == "__main__":
    unittest.main()
