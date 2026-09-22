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
    assert 'text/event-stream' in chat_api
    assert 'event: ${event}' in chat_api
    assert 'response.body.getReader()' in chat_composer
    assert 'eventName === "delta"' in chat_composer
    assert 'stream: true' in chat_provider
    assert 'openrouter/free' in chat_provider
    assert 'https://openrouter.ai/api/v1/chat/completions' in chat_provider
    assert 'OPENROUTER_API_KEY' in chat_provider
    assert 'provider: providerResult.provider' in chat_api
    assert 'model: providerResult.model' in chat_api
    assert 'balance or free quota' in chat_provider
    assert 'thinking: { type: "disabled" }' in chat_provider
    assert 'reasoning_effort: "none"' in chat_provider
    assert 'propose_scientific_action' in chat_provider
    assert 'msa_phylogeny_workflow' in chat_provider
    assert 'ai_workflow_runs' in chat_conversation
    assert 'phylogeny_job_id' in chat_conversation
    assert 'media_attachments' in chat_api
    assert 'image/jpeg' in chat_api
    assert 'image/png' in chat_api
    assert 'image/gif' in chat_api
    assert 'image/webp' in chat_api
    assert 'onDrop={(event)' in chat_composer
    assert 'attachmentPreview' in chat_composer
    assert 'readyMediaAttachments' in chat_composer
    assert 'media_attachments: readyMediaAttachments' in chat_composer
    assert 'liveAssistantMessage ? (' in chat_composer
    assert 'image_url' in chat_provider
    assert 'AbortController' in chat_composer
    assert 'stopGeneration' in chat_composer
    assert 'onPaste={(event)' in chat_composer
    assert 'resizeTextarea' in chat_composer
    assert 'signal: abortController.signal' in chat_composer
    assert 'request.signal' in chat_api
    assert 'signal?: AbortSignal' in chat_provider
    assert 'partialVisible || "Generation stopped."' in chat_api
    assert 'finish_ai_plan_inline_error' not in chat_api
    assert 'request_ai_chat_turn' in chat_api
    assert 'finish_ai_chat_turn' in chat_api
    assert 'create_ai_plan_from_chat' in chat_api
    assert 'dispatch_ai_plan_service' in chat_api
    assert 'requires_confirmation: false' in chat_api
    assert 'request_ai_plan_inline' not in chat_api
    assert '/content' in chat_composer
    assert 'status: "validating"' in chat_composer
    assert 'processing_error' in chat_composer
    assert 'I can do [supported task] for you.' in chat_provider
    assert 'capability_preflight' in chat_provider
    assert 'relevant capability_preflight flag is false' in chat_provider
    assert 'closest supported path' in chat_provider
    assert 'Genithm will start the validated task automatically' in chat_provider
    assert 'key={`${conversation.id}:${messages?.length ?? 0}`}' in chat_conversation

    print("PASS: V1 dashboard UI shell contract")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
