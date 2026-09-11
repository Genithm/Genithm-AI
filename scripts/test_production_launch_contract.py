from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    launch = (ROOT / "scripts/production_launch.py").read_text(encoding="utf-8")
    web_vars = (ROOT / "apps/web/.dev.vars.example").read_text(encoding="utf-8")
    web_doc = (ROOT / "docs/deployment/CLOUDFLARE_WEB_V1.md").read_text(encoding="utf-8")
    runbook = (ROOT / "docs/deployment/PRODUCTION_LAUNCH_V1.md").read_text(encoding="utf-8")

    required_launch_tokens = [
        "oracle_deploy_preflight.py",
        '"pull"',
        '"up", "-d", "--remove-orphans"',
        '"ps"',
        "--pull-only",
    ]
    for token in required_launch_tokens:
        assert token in launch, f"missing launch-controller contract token: {token}"

    assert "NEXT_PUBLIC_GENITHM_API_URL=http://localhost:8000" in web_vars
    assert "NEXT_PUBLIC_GENITHM_API_URL=https://<production-api-origin>" in web_doc
    assert "Production must never fall back to `http://localhost:8000`" in web_doc
    assert "Cloudflare Workers" in runbook
    assert "render_v1_deployment_env.py" in runbook
    assert "production_smoke.py" in runbook
    assert "6 expected workers and 9 expected queues" in runbook
    assert "Vercel" not in web_doc

    print("PASS: V1 production launch contract")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
