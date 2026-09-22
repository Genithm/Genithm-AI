from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LOGIN_PAGE = ROOT / "apps/web/app/login/page.tsx"
SIGNUP_PAGE = ROOT / "apps/web/app/signup/page.tsx"
ACTIONS = ROOT / "apps/web/app/login/actions.ts"
STYLES = ROOT / "apps/web/app/login/login.module.css"
NEXT_CONFIG = ROOT / "apps/web/next.config.ts"
PREVIEW_LAUNCHER = ROOT / "scripts/codespaces_preview.sh"
PROXY_ENTRY = ROOT / "apps/web/proxy.ts"
OLD_MIDDLEWARE = ROOT / "apps/web/middleware.ts"
DASHBOARD_LAYOUT = ROOT / "apps/web/app/dashboard/layout.tsx"
CHAT_COMPOSER = ROOT / "apps/web/components/ai-chat-composer.tsx"


def test_auth_entry_preserves_supabase_server_actions_and_secure_contract():
    login_page = LOGIN_PAGE.read_text()
    signup_page = SIGNUP_PAGE.read_text()
    actions = ACTIONS.read_text()
    styles = STYLES.read_text()
    next_config = NEXT_CONFIG.read_text()
    preview_launcher = PREVIEW_LAUNCHER.read_text()
    proxy_entry = PROXY_ENTRY.read_text()
    dashboard_layout = DASHBOARD_LAYOUT.read_text()
    chat_composer = CHAT_COMPOSER.read_text()

    assert 'import { login } from "./actions"' in login_page
    assert 'action={login}' in login_page
    assert 'href="/signup"' in login_page
    assert 'role="alert"' in login_page
    assert 'role="status"' in login_page
    assert 'autoComplete="email"' in login_page
    assert 'minLength={10}' in login_page

    assert 'import { signup } from "../login/actions"' in signup_page
    assert 'action={signup}' in signup_page
    assert 'name="password_confirmation"' in signup_page
    assert 'href="/legal/terms"' in signup_page
    assert 'href="/legal/privacy"' in signup_page
    assert 'role="alert"' in signup_page

    assert 'signInWithPassword' in actions
    assert 'auth.signUp' in actions
    assert 'emailRedirectTo' in actions
    assert 'password_confirmation' in actions
    assert 'GENITHM_APP_URL' in actions
    assert 'formData.get("origin")' not in actions
    assert 'name="origin"' not in signup_page
    assert "service_role" not in login_page.lower()
    assert "service_role" not in signup_page.lower()
    assert "service_role" not in actions.lower()

    assert 'serverActions' in next_config
    assert 'allowedOrigins' in next_config
    assert 'CODESPACE_NAME' in next_config
    assert 'localhost:3000' in next_config
    assert '127.0.0.1:3000' in next_config

    assert '/auth/v1/settings' in preview_launcher
    assert 'disable_signup' in preview_launcher
    assert 'email authentication is disabled' in preview_launcher
    assert 'get_release_readiness' in preview_launcher
    assert '"status"' in preview_launcher
    assert '"ready"' in preview_launcher
    assert 'SUPABASE_SECRET_KEY' in preview_launcher
    assert 'OPENROUTER_API_KEY' in preview_launcher
    assert 'https://openrouter.ai/api/v1/models' in preview_launcher
    assert 'https://openrouter.ai/api/v1/chat/completions' in preview_launcher
    assert 'GENITHM_API_IMAGE' in preview_launcher
    assert 'GENITHM_SEQUENCE_WORKER_IMAGE' in preview_launcher
    assert 'GENITHM_SOURCE_WORKER_IMAGE' in preview_launcher
    assert 'GENITHM_BLAST_WORKER_IMAGE' in preview_launcher
    assert 'GENITHM_SCIENTIFIC_WORKER_IMAGE' in preview_launcher
    assert 'GENITHM_AUDIT_WORKER_IMAGE' in preview_launcher
    assert 'GENITHM_AI_WORKER_IMAGE' in preview_launcher
    assert 'RUNTIME_SHA' in preview_launcher
    assert 'release/v1/candidate.json' in preview_launcher
    assert 'runtime_images=(' in preview_launcher
    assert 'git -C "$ROOT_DIR" rev-parse HEAD' in preview_launcher

    assert 'export async function proxy(request: NextRequest)' in proxy_entry
    assert 'return updateSession(request)' in proxy_entry
    assert not OLD_MIDDLEWARE.exists()
    assert 'supabase.auth.getClaims()' in dashboard_layout
    assert '!claims?.sub' in dashboard_layout
    assert 'redirect("/login?message="' in dashboard_layout
    assert 'response.status === 401' in chat_composer
    assert 'Your session expired. Please sign in again.' in chat_composer

    assert "@media (max-width: 600px)" in styles
    assert "prefers-reduced-motion" in styles


def main():
    test_auth_entry_preserves_supabase_server_actions_and_secure_contract()
    print("V1 auth entry UI contract: PASS")


if __name__ == "__main__":
    main()
