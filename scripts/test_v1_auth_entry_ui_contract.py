from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PAGE = ROOT / "apps/web/app/login/page.tsx"
ACTIONS = ROOT / "apps/web/app/login/actions.ts"
STYLES = ROOT / "apps/web/app/login/login.module.css"


def test_auth_entry_preserves_supabase_server_actions_and_secure_contract():
    page = PAGE.read_text()
    actions = ACTIONS.read_text()
    styles = STYLES.read_text()

    assert 'import { login, signup } from "./actions"' in page
    assert 'formAction={login}' in page
    assert 'formAction={signup}' in page
    assert 'href="/legal/terms"' in page
    assert 'href="/legal/privacy"' in page
    assert 'role="alert"' in page
    assert 'role="status"' in page
    assert 'autoComplete="email"' in page
    assert 'minLength={10}' in page
    assert 'signInWithPassword' in actions
    assert 'auth.signUp' in actions
    assert 'emailRedirectTo' in actions
    assert "service_role" not in page.lower()
    assert "service-role" not in page.lower()
    assert "service_role" not in actions.lower()
    assert "@media (max-width: 600px)" in styles
    assert "prefers-reduced-motion" in styles
