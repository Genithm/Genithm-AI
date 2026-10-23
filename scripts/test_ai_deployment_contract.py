from __future__ import annotations

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "deploy" / "kubernetes" / "workers.yaml"
AI_RUNTIME = ROOT / "apps" / "ai-worker" / "genithm_ai_worker" / "runtime.py"

PRIMARY = (
    "GEMINI_API_KEY",
)
BACKUP = (
    "GROQ_API_KEY",
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
            self.assertIn("provider_configs_from_env()", self.runtime)
            self.assertIn(f"name: {name}, valueFrom:", self.ai)
            self.assertIn(f"key: {name}}}}}", self.ai)
        self.assertNotIn("name: OPENAI_API_KEY,", self.ai)
        self.assertNotIn("name: GENITHM_AI_MODEL,", self.ai)

    def test_groq_backup_secret_is_required_in_development(self) -> None:
        for name in BACKUP:
            self.assertIn(f"name: {name}, valueFrom:", self.ai)
            self.assertIn(f"key: {name}}}}}", self.ai)

    def test_ai_heartbeat_identifies_new_dispatch_version(self) -> None:
        self.assertIn('USER_AGENT = "genithm-ai-worker/0.6.0"', self.runtime)
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
