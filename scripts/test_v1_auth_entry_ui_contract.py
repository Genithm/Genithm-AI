from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LOGIN_PAGE = ROOT / "apps/web/app/login/page.tsx"
SIGNUP_PAGE = ROOT / "apps/web/app/signup/page.tsx"
LOGIN_ROUTE = ROOT / "apps/web/app/auth/login/route.ts"
SIGNUP_ROUTE = ROOT / "apps/web/app/auth/signup/route.ts"
STYLES = ROOT / "apps/web/app/login/login.module.css"


def test_auth_entry_uses_post_routes_and_secure_supabase_contract():
    login_page = LOGIN_PAGE.read_text()
    signup_page = SIGNUP_PAGE.read_text()
    login_route = LOGIN_ROUTE.read_text()
    signup_route = SIGNUP_ROUTE.read_text()
    styles = STYLES.read_text()

    assert 'action="/auth/login"' in login_page
    assert 'method="post"' in login_page
    assert 'href="/signup"' in login_page
    assert 'role="alert"' in login_page
    assert 'role="status"' in login_page
    assert 'autoComplete="email"' in login_page
    assert 'minLength={10}' in login_page

    assert 'action="/auth/signup"' in signup_page
    assert 'method="post"' in signup_page
    assert 'name="password_confirmation"' in signup_page
    assert 'href="/legal/terms"' in signup_page
    assert 'href="/legal/privacy"' in signup_page
    assert 'role="alert"' in signup_page

    assert 'signInWithPassword' in login_route
    assert 'auth.signUp' in signup_route
    assert 'emailRedirectTo' in signup_route
    assert 'password_confirmation' in signup_route
    assert 'request.nextUrl.origin' in signup_route
    assert "service_role" not in login_page.lower()
    assert "service_role" not in signup_page.lower()
    assert "service_role" not in login_route.lower()
    assert "service_role" not in signup_route.lower()

    assert "@media (max-width: 600px)" in styles
    assert "prefers-reduced-motion" in styles


def main():
    test_auth_entry_uses_post_routes_and_secure_supabase_contract()
    print("V1 auth entry UI contract: PASS")


if __name__ == "__main__":
    main()
