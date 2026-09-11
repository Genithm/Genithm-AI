from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    page = (ROOT / "apps/web/app/dashboard/scientific-jobs/[id]/page.tsx").read_text(encoding="utf-8")
    status = (ROOT / "apps/web/app/dashboard/scientific-jobs/[id]/scientific-job-status.tsx").read_text(encoding="utf-8")
    styles = (ROOT / "apps/web/app/dashboard/scientific-jobs/[id]/scientific-job.module.css").read_text(encoding="utf-8")

    for token in (
        "ScientificJobStatus",
        "Key findings",
        "Reproducibility record",
        "Parameters & provenance",
        "Scientific job dependencies",
        "Download raw result",
    ):
        assert token in page, f"missing result UI contract token: {token}"

    for token in (
        "window.setInterval",
        "router.refresh()",
        "document.visibilityState",
        "aria-live=\"polite\"",
        "execution timeline",
    ):
        assert token in status, f"missing live status contract token: {token}"

    for token in (".statusBadge", ".timeline", ".metricGrid", ".disclosure", "@media (max-width: 760px)"):
        assert token in styles, f"missing scientific result style token: {token}"

    assert "service_role" not in page
    assert "service_role" not in status
    print("PASS: V1 scientific result UI contract")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
