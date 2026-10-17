from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def main() -> int:
    overview = (ROOT / 'apps/web/components/dashboard-home-overview.tsx').read_text(encoding='utf-8')
    nav = (ROOT / 'apps/web/components/dashboard-section-navigator.tsx').read_text(encoding='utf-8')
    layout = (ROOT / 'apps/web/app/dashboard/layout.tsx').read_text(encoding='utf-8')
    projects = (ROOT / 'apps/web/app/dashboard/projects/page.tsx').read_text(encoding='utf-8')
    home = (ROOT / 'apps/web/app/dashboard/page.tsx').read_text(encoding='utf-8')
    # Keep the legacy overview's data-safety contract, but do not inject a second
    # dashboard and section navigation into every route in the simpler V40 UI.
    assert 'pathname !== "/dashboard"' in overview
    assert 'createClient' in overview
    assert 'sequence_uploads' in overview
    assert 'scientific_jobs' in overview
    assert 'service_role' not in overview.lower()
    assert 'service-role' not in overview.lower()
    assert '<DashboardHomeOverview' not in layout
    assert '<DashboardSectionNavigator' not in layout
    assert 'GenithmWorkspaceFrame' in layout
    assert 'getClaims()' in layout
    assert 'pathname !== "/dashboard"' in nav
    assert 'aria-current={active ? "step" : undefined}' in nav
    assert 'Recommended next step' in overview
    assert 'Active jobs' in overview
    assert 'redirect("/dashboard/ai")' in home
    assert 'getClaims()' in projects
    assert '.eq("status","active")' in projects
    assert 'createAiResearchProject' in projects
    assert 'role="alert"' in projects
    assert 'service_role' not in projects
    print('PASS: focused chat home and project catalogue preserve workspace access boundaries')
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
