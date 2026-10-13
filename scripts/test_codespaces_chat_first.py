#!/usr/bin/env python3
"""Contracts for chat-first Codespaces and authenticated scientific workflows.

These supplement actual Next.js typecheck/build, local scientific-engine tests
and the end-to-end /preview HTTP smoke test; they cannot replace those tests.
"""
from __future__ import annotations

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "apps" / "web"


def source(path: str) -> str:
    return (WEB / path).read_text(encoding="utf-8")


class ChatFirstContract(unittest.TestCase):
    def test_offline_chat_is_primary_and_manual_labs_are_optional(self):
        page = source("app/preview/page.tsx")
        self.assertIn('import { ChatFirstLab }', page)
        self.assertIn("<ChatFirstLab />", page)
        self.assertIn('<details className={styles.advancedLabs}>', page)
        self.assertLess(page.index("<ChatFirstLab />"), page.index("<SampleWorkbench />"))
        self.assertLess(page.index("<ChatFirstLab />"), page.index("<LiveSequenceLab />"))

    def test_local_chat_calls_only_development_scientific_api_with_bounded_request(self):
        chat = source("app/preview/chat-first-lab.tsx")
        api = source("app/api/dev-science/route.ts")
        self.assertIn('fetch("/api/dev-science"', chat)
        self.assertIn("const MAX_CHARS = 5500", chat)
        self.assertIn("const MAX_TURNS = 60", chat)
        self.assertIn("response.ok", chat)
        self.assertIn('output.mode !== "local-development-only"', chat)
        self.assertIn('"application/json"', chat)
        self.assertIn('request.headers.get("sec-fetch-site")', api)
        self.assertIn('process.env.NODE_ENV !== "development"', api)
        self.assertIn('process.env.GENITHM_CODESPACES_PREVIEW !== "1"', api)
        self.assertNotIn("createServiceClient", chat)
        self.assertNotIn("service_role", chat)
        self.assertNotIn('fetch("https://', chat)

    def test_local_chat_asks_for_missing_inputs_and_never_claims_ai_provider(self):
        chat = source("app/preview/chat-first-lab.tsx")
        for kind in (
            "orf_scan", "six_frame_translation", "motif_scan",
            "reverse_complement", "composition_profile",
            "pairwise_global", "pairwise_local", "comparison_matrix",
            "msa_conservation", "msa_phylogeny",
        ):
            self.assertIn(kind, chat)
        self.assertIn("if (!chosenSource)", chat)
        self.assertIn('action.operation === "motif_scan" && !action.motif', chat)
        self.assertIn('if (!action)', chat)
        self.assertIn("Please paste a DNA/RNA", chat)
        self.assertIn("This Codespaces demo uses rule-based intent detection", chat)
        self.assertIn("not a signed research artifact", chat)
        self.assertIn("Download complete JSON result", chat)

    def test_auth_chat_onboarding_is_scoped_and_opt_in(self):
        home = source("app/dashboard/ai/page.tsx")
        actions = source("app/dashboard/ai/actions.ts")
        self.assertIn("startChatWorkspace", home)
        self.assertIn("Start my research chat", home)
        self.assertIn("Does not start scientific computing", home)
        self.assertIn("supabase.auth.getClaims()", actions)
        self.assertIn('supabase.from("organizations")', actions)
        self.assertIn('supabase.from("projects").insert', actions)
        self.assertIn('supabase.rpc("create_organization"', actions)
        self.assertIn("created_by: userId", actions)
        self.assertIn('redirect("/dashboard/ai")', actions)

    def test_authorized_scientific_results_remain_in_chat(self):
        page = source("app/dashboard/ai/[id]/page.tsx")
        actions = source("app/dashboard/ai/actions.ts")
        self.assertIn(".from(\"ai_conversations\")", page)
        self.assertIn(".from(\"scientific_jobs\")", page)
        self.assertIn("result_summary,result_sha256", page)
        self.assertIn("recordedMetrics", page)
        self.assertIn("Recorded scientific findings", page)
        self.assertIn("Download verified scientific output", page)
        self.assertIn("approveAiPlan", page)
        self.assertIn("requestAiInterpretation", page)
        self.assertIn("<ConversationProgressRefresh", page)
        self.assertIn("Genithm interpretation", page)
        self.assertLess(page.index('<section className={styles.activity}'), page.index('<AiChatComposer'))
        approve = actions.split("export async function approveAiPlan", 1)[1].split(
            "export async function requestAiInterpretation", 1
        )[0]
        self.assertNotIn('redirect(\`/dashboard/scientific-jobs/', approve)
        self.assertNotIn('redirect(\`/dashboard/protein-annotations/', approve)

    def test_refresh_only_when_active_and_visible(self):
        refresh = source("app/dashboard/ai/[id]/conversation-progress-refresh.tsx")
        self.assertIn("if (!active) return", refresh)
        self.assertIn('document.visibilityState === "visible"', refresh)
        self.assertIn("window.clearInterval(interval)", refresh)
        self.assertIn("router.refresh()", refresh)


if __name__ == "__main__":
    unittest.main()
