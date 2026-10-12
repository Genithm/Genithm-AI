from __future__ import annotations

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "deploy" / "kubernetes" / "workers.yaml"
AI_RUNTIME = ROOT / "apps" / "ai-worker" / "genithm_ai_worker" / "runtime.py"

PRIMARY = (
    "GENITHM_AI_PRIMARY_API_KEY",
    "GENITHM_AI_PRIMARY_ENDPOINT",
    "GENITHM_AI_PRIMARY_MODEL",
)
BACKUP = (
    "GENITHM_AI_BACKUP_API_KEY",
    "GENITHM_AI_BACKUP_ENDPOINT",
    "GENITHM_AI_BACKUP_MODEL",
)


def ai_container(manifest: str) -> str:
    marker = "metadata:\n  name: ai-worker\n"
    if marker not in manifest:
        raise ValueError("AI worker deployment missing")
    return manifest[manifest.index(marker):]


class AiKubernetesSettingsContractTests(unittest.TestCase):
    def setUp(self) -> None:
        self.manifest = MANIFEST.read_text(encoding="utf-8")
        self.runtime = AI_RUNTIME.read_text(encoding="utf-8")
        self.ai = ai_container(self.manifest)

    def test_required_provider_keys_exactly_match_runtime(self) -> None:
        for name in PRIMARY:
            self.assertIn(f'_required_env("{name}")', self.runtime)
            self.assertIn(f"name: {name}, valueFrom:", self.ai)
            self.assertIn(f"key: {name}}}}}", self.ai)
        self.assertNotIn("name: OPENAI_API_KEY,", self.ai)
        self.assertNotIn("name: GENITHM_AI_MODEL,", self.ai)

    def test_backup_explicitly_opt_in_and_secret_refs_optional(self) -> None:
        self.assertIn('GENITHM_AI_BACKUP_ENABLED: "false"', self.manifest)
        for name in BACKUP:
            self.assertIn(f"name: {name}, valueFrom:", self.ai)
            self.assertIn(f"key: {name}, optional: true", self.ai)

    def test_ai_heartbeat_identifies_new_dispatch_version(self) -> None:
        self.assertIn('USER_AGENT = "genithm-ai-worker/0.5.0"', self.runtime)
        self.assertIn("Settings.from_env()", (
            ROOT / "apps" / "ai-worker" / "genithm_ai_worker" / "entrypoint.py"
        ).read_text(encoding="utf-8"))

    def test_no_provider_secret_values_embedded_in_manifest(self) -> None:
        # Deployment references external Kubernetes Secrets; no inline values.
        for name in PRIMARY + BACKUP:
            self.assertFalse(bool(re.search(rf"(?m)^\s+{re.escape(name)}:\s*[^#\n]+", self.manifest)))
        self.assertNotIn("kind: Secret\n", self.manifest)


if __name__ == "__main__":
    unittest.main()
