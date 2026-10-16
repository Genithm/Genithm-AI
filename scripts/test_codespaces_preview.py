from __future__ import annotations

import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEV = ROOT / ".devcontainer"
WEB = ROOT / "apps/web"


class CodespacesPreviewContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.config = json.loads((DEV / "devcontainer.json").read_text(encoding="utf-8"))
        cls.proxy = (WEB / "proxy.ts").read_text(encoding="utf-8")
        cls.preview = (WEB / "app/preview/page.tsx").read_text(encoding="utf-8")

    def test_codespaces_startup_and_private_port(self):
        self.assertEqual(self.config["forwardPorts"], [3000])
        self.assertEqual(self.config["portsAttributes"]["3000"]["visibility"], "private")
        self.assertEqual(self.config["portsAttributes"]["3000"]["onAutoForward"], "openBrowser")
        self.assertTrue(self.config["postCreateCommand"].startswith("bash .devcontainer/setup.sh || "))
        self.assertTrue(self.config["postStartCommand"].startswith("bash .devcontainer/start.sh || "))
        self.assertIn("true;", self.config["postCreateCommand"])
        self.assertIn("true;", self.config["postStartCommand"])
        self.assertEqual(self.config["remoteEnv"]["GENITHM_CODESPACES_PREVIEW"], "1")
        self.assertNotIn("9000", self.config["portsAttributes"])

    def test_codespaces_uses_preinstalled_node22_not_fragile_feature_install(self):
        self.assertEqual(
            self.config["image"],
            "mcr.microsoft.com/devcontainers/javascript-node:22-bookworm",
        )
        self.assertNotIn("features", self.config)
        self.assertIn("setup.sh", self.config["postCreateCommand"])
        self.assertIn("start.sh", self.config["postStartCommand"])

    def test_no_secrets_embedded_in_codespace_definition(self):
        document = json.dumps(self.config)
        self.assertNotIn("SUPABASE_SECRET_KEY", document)
        self.assertNotIn("DEEPSEEK_API_KEY", document)
        self.assertNotIn("sb_secret_", document)
        self.assertNotIn("service_role", document)

    def test_authenticated_routes_blocked_without_public_configuration(self):
        self.assertIn('process.env.NODE_ENV === "development"', self.proxy)
        self.assertIn('process.env.GENITHM_CODESPACES_PREVIEW === "1"', self.proxy)
        self.assertIn('pathname === "/preview"', self.proxy)
        self.assertIn('pathname === "/login"', self.proxy)
        self.assertIn('pathname === "/signup"', self.proxy)
        self.assertIn('setupUrl.pathname = "/login"', self.proxy)
        self.assertIn("return NextResponse.redirect(setupUrl)", self.proxy)
        self.assertIn("return updateSession(request)", self.proxy)

    def test_preview_never_enabled_in_production(self):
        self.assertIn('process.env.NODE_ENV !== "development"', self.preview)
        self.assertIn("notFound()", self.preview)
        self.assertIn("No live customer job is submitted", self.preview)
        self.assertIn("SampleWorkbench", self.preview)

    def test_real_science_is_used_by_local_smoke(self):
        smoke = (ROOT / "scripts/codespaces-science-smoke.py").read_text(encoding="utf-8")
        self.assertIn("from genithm_scientific_worker.sequence_insights import", smoke)
        for operation in ("orf_scan", "six_frame_translation", "motif_scan", "reverse_complement"):
            self.assertIn(f'operation="{operation}"', smoke)

    def test_live_science_api_is_development_only_and_routes_are_protected(self):
        route = (WEB / "app/api/dev-science/route.ts").read_text(encoding="utf-8")
        self.assertIn('process.env.NODE_ENV !== "development"', route)
        self.assertIn('process.env.GENITHM_CODESPACES_PREVIEW !== "1"', route)
        self.assertIn('request.headers.get("sec-fetch-site")', route)
        self.assertIn("MAX_BODY_BYTES = 8192", route)
        self.assertIn('http://127.0.0.1:8769/analyze', route)
        self.assertIn('request.nextUrl.pathname === "/api/dev-science"', self.proxy)
        self.assertIn('return updateSession(request)', self.proxy)

    def test_local_scientific_server_is_loopback_only(self):
        server = (ROOT / "scripts/codespaces-live-science-server.py").read_text(encoding="utf-8")
        start = (DEV / "start.sh").read_text(encoding="utf-8")
        self.assertIn('("127.0.0.1", PORT)', server)
        self.assertIn("threading.BoundedSemaphore(2)", server)
        self.assertIn("scripts/codespaces-live-science-server.py", start)
        self.assertNotIn("8769", json.dumps(self.config))

    def test_chat_first_science_preview_is_primary_and_local(self):
        source = (WEB / "app/preview/chat-science-lab.tsx").read_text(encoding="utf-8")
        self.assertIn("ChatScienceLab", self.preview)
        self.assertLess(self.preview.index("<ChatScienceLab />"), self.preview.index("<LiveSequenceLab />"))
        self.assertIn('fetch("/api/dev-science"', source)
        self.assertIn("Attach FASTA", source)
        self.assertIn("Export scientific JSON", source)
        self.assertIn("data.input_sha256", source)
        self.assertNotIn("service_role", source)
        self.assertNotIn("NEXT_PUBLIC_SUPABASE", source)

    def test_setup_installs_from_lockfile(self):
        setup = (DEV / "setup.sh").read_text(encoding="utf-8")
        self.assertIn("npm --prefix apps/web ci", setup)
        self.assertIn("scripts/codespaces-science-smoke.py", setup)
        self.assertNotIn("db push", setup)
        self.assertNotIn("service_role", setup)


if __name__ == "__main__":
    unittest.main()
