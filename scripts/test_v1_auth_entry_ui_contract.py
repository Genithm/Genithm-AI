from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LOGIN_PAGE = ROOT / "apps/web/app/login/page.tsx"
SIGNUP_PAGE = ROOT / "apps/web/app/signup/page.tsx"
ACTIONS = ROOT / "apps/web/app/login/actions.ts"
STYLES = ROOT / "apps/web/app/login/login.module.css"
NEXT_CONFIG = ROOT / "apps/web/next.config.ts"


def test_auth_entry_preserves_supabase_server_actions_and_secure_contract():
    login_page = LOGIN_PAGE.read_text()
    signup_page = SIGNUP_PAGE.read_text()
    actions = ACTIONS.read_text()
    styles = STYLES.read_text()
    next_config = NEXT_CONFIG.read_text()

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
    assert "service_role" not in login_page.lower()
    assert "service_role" not in signup_page.lower()
    assert "service_role" not in actions.lower()

    assert 'serverActions' in next_config
    assert 'allowedOrigins' in next_config
    assert 'CODESPACE_NAME' in next_config

    assert "@media (max-width: 600px)" in styles
    assert "prefers-reduced-motion" in styles


def main():
    test_auth_entry_preserves_supabase_server_actions_and_secure_contract()
    print("V1 auth entry UI contract: PASS")


if __name__ == "__main__":
    main()
