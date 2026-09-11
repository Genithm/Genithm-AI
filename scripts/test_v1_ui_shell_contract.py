from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    layout = (ROOT / "apps/web/app/dashboard/layout.tsx").read_text(encoding="utf-8")
    primary_nav = (ROOT / "apps/web/components/dashboard-primary-nav.tsx").read_text(encoding="utf-8")
    section_nav = (ROOT / "apps/web/components/dashboard-section-navigator.tsx").read_text(encoding="utf-8")
    section_css = (ROOT / "apps/web/app/dashboard/dashboard-section-nav.css").read_text(encoding="utf-8")

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

    print("PASS: V1 dashboard UI shell contract")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
