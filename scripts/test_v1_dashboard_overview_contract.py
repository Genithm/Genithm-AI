from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OVERVIEW = ROOT / "apps/web/components/dashboard-home-overview.tsx"
NAV = ROOT / "apps/web/components/dashboard-section-navigator.tsx"
LAYOUT = ROOT / "apps/web/app/dashboard/layout.tsx"


def main() -> int:
    overview = OVERVIEW.read_text(encoding="utf-8")
    nav = NAV.read_text(encoding="utf-8")
    layout = LAYOUT.read_text(encoding="utf-8")

    assert 'pathname !== "/dashboard"' in overview
    assert 'createClient' in overview
    assert 'sequence_uploads' in overview
    assert 'scientific_jobs' in overview
    assert 'service_role' not in overview.lower()
    assert 'service-role' not in overview.lower()
    assert 'DashboardHomeOverview' in layout
    assert '<DashboardHomeOverview />' in layout
    assert 'pathname !== "/dashboard"' in nav
    assert 'aria-current={active ? "step" : undefined}' in nav
    assert 'Recommended next step' in overview
    assert 'Active jobs' in overview

    print("PASS: V1 dashboard overview contract")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
