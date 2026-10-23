from pathlib import Path
import re

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
    assert 'service_role' not in login_page.lower()
    assert 'service_role' not in signup_page.lower()
    assert 'service_role' not in actions.lower()
    assert 'serverActions' in next_config
    assert 'allowedOrigins' in next_config
    assert 'CODESPACE_NAME' in next_config
    assert 'localhost:3000' in next_config
    assert '127.0.0.1:3000' in next_config
    for token in ['/auth/v1/settings','disable_signup','email authentication is disabled','get_release_readiness','"status"','"ready"','SUPABASE_SECRET_KEY','GEMINI_API_KEY','GROQ_API_KEY','scripts/check_ai_provider_models.py','GENITHM_API_IMAGE','GENITHM_SEQUENCE_WORKER_IMAGE','GENITHM_SOURCE_WORKER_IMAGE','GENITHM_BLAST_WORKER_IMAGE','GENITHM_SCIENTIFIC_WORKER_IMAGE','GENITHM_AUDIT_WORKER_IMAGE','GENITHM_AI_WORKER_IMAGE','RUNTIME_SHA','Development runtime must match','runtime_images=(', 'git -C "$ROOT_DIR" rev-parse HEAD']:
        assert token in preview_launcher, token
    assert 'export async function proxy(request: NextRequest)' in proxy_entry
    assert 'return updateSession(request)' in proxy_entry
    assert not OLD_MIDDLEWARE.exists()
    assert 'supabase.auth.getClaims()' in dashboard_layout
    assert '!claims?.sub' in dashboard_layout
    assert 'redirect("/login?message="' in dashboard_layout
    assert 'response.status === 401' in chat_composer
    assert 'Your session expired. Please sign in again.' in chat_composer
    assert re.search(r'@media\s*\(max-width:\s*600px\)', styles)
    assert 'prefers-reduced-motion' in styles
    assert 'var(--g-line)' in styles
    assert 'var(--g-ink)' in styles
    assert 'genithm-logo.webp' in styles


def main():
    test_auth_entry_preserves_supabase_server_actions_and_secure_contract()
    print('V1 auth entry UI contract: PASS (light branding, authentication unchanged)')


if __name__ == '__main__':
    main()
