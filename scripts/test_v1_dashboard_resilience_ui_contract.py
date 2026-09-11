from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LOADING = ROOT / "apps/web/app/dashboard/loading.tsx"
ERROR = ROOT / "apps/web/app/dashboard/error.tsx"
STYLES = ROOT / "apps/web/app/dashboard/dashboard-state.module.css"


def require(text: str, token: str) -> None:
    if token not in text:
        raise SystemExit(f"missing contract token: {token}")


def main() -> None:
    loading = LOADING.read_text()
    error = ERROR.read_text()
    styles = STYLES.read_text()

    require(loading, 'aria-busy="true"')
    require(loading, 'aria-live="polite"')
    require(loading, "Loading your scientific workspace")
    require(error, '"use client"')
    require(error, "reset()")
    require(error, 'href="/dashboard"')
    require(error, 'role="alert"')
    require(error, "error.digest")
    require(styles, "prefers-reduced-motion")
    require(styles, "@media (max-width: 760px)")


if __name__ == "__main__":
    main()
