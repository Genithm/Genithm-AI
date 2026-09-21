from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    layout = (ROOT / "apps/web/app/dashboard/layout.tsx").read_text(encoding="utf-8")
    primary_nav = (ROOT / "apps/web/components/dashboard-primary-nav.tsx").read_text(encoding="utf-8")
    section_nav = (ROOT / "apps/web/components/dashboard-section-navigator.tsx").read_text(encoding="utf-8")
    section_css = (ROOT / "apps/web/app/dashboard/dashboard-section-nav.css").read_text(encoding="utf-8")
    dashboard_home = (ROOT / "apps/web/app/dashboard/page.tsx").read_text(encoding="utf-8")
    chat_home = (ROOT / "apps/web/app/dashboard/ai/page.tsx").read_text(encoding="utf-8")
    chat_conversation = (ROOT / "apps/web/app/dashboard/ai/[id]/page.tsx").read_text(encoding="utf-8")
    chat_composer = (ROOT / "apps/web/components/ai-chat-composer.tsx").read_text(encoding="utf-8")
    chat_api = (ROOT / "apps/web/app/api/ai/chat/route.ts").read_text(encoding="utf-8")
    chat_provider = (ROOT / "apps/web/lib/genithm-ai-chat.ts").read_text(encoding="utf-8")

    assert "DashboardPrimaryNav" in layout
    assert 'aria-label="Workspace navigation"' in primary_nav
    assert "usePathname" in primary_nav
    assert 'aria-current={active ? "page" : undefined}' in primary_nav
    assert "IntersectionObserver" in section_nav
    assert 'aria-current={active ? "step" : undefined}' in section_nav
    assert "dashboard-section-link is-active" in section_nav
    assert ".dashboard-nav-link.is-active" in section_css
    assert ".dashboard-section-link.is-active" in section_css
    assert "prefers-reduced-motion" in section_css

    assert 'redirect("/dashboard/ai")' in dashboard_home
    assert 'label: "Chat"' in primary_nav
    assert 'label: "Advanced tools"' in primary_nav
    assert 'AiChatComposer' in chat_home
    assert '/dashboard/tools' in chat_home
    assert 'AiChatComposer' in chat_conversation
    assert 'action={requestAiPlan}' not in chat_conversation
    assert 'action={approveAiPlan}' in chat_conversation
    assert 'Research activity' in chat_conversation
    assert 'aria-label={conversationId ? "Reply to Genithm" : "Message Genithm"}' in chat_composer
    assert 'Attach' in chat_composer
    assert '/api/ai/chat' in chat_composer
    assert '/api/v1/storage/sequence-uploads' in chat_composer
    assert 'request_ai_plan_inline' in chat_api
    assert 'finish_ai_plan_inline' in chat_api
    assert 'text/event-stream' in chat_api
    assert 'event: ${event}' in chat_api
    assert 'response.body.getReader()' in chat_composer
    assert 'eventName === "delta"' in chat_composer
    assert 'stream: true' in chat_provider
    assert 'thinking: { type: "disabled" }' in chat_provider
    assert 'reasoning_effort: "none"' in chat_provider
    assert 'propose_scientific_action' in chat_provider

    print("PASS: V1 dashboard UI shell contract")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
