from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GUARD = ROOT / "apps/web/components/analysis-launch-guard.tsx"
LAYOUT = ROOT / "apps/web/app/dashboard/layout.tsx"


def main() -> None:
    guard = GUARD.read_text()
    layout = LAYOUT.read_text()

    assert 'pathname !== "/dashboard"' in guard
    assert 'select[name="project_id"]' in guard
    assert 'select[name="sequence_a_id"]' in guard
    assert 'select[name="sequence_b_id"]' in guard
    assert 'select[name="sequence_upload_ids"]' in guard
    assert 'option.hidden = !allowed' in guard
    assert 'option.disabled = !allowed' in guard
    assert 'projectSelect.addEventListener("change", sync)' in guard
    assert 'projectSelect.removeEventListener("change", sync)' in guard
    assert "service_role" not in guard.lower()
    assert "service-role" not in guard.lower()
    assert 'import { AnalysisLaunchGuard }' in layout
    assert '<AnalysisLaunchGuard />' in layout


if __name__ == "__main__":
    main()
