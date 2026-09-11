from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    rollback = (ROOT / "scripts/production_rollback.py").read_text(encoding="utf-8")
    runbook = (ROOT / "docs/deployment/PRODUCTION_LAUNCH_V1.md").read_text(encoding="utf-8")

    required_tokens = [
        "oracle_deploy_preflight.py",
        '"pull"',
        '"up", "-d", "--remove-orphans"',
        '"ps"',
        "--expected-source-sha",
        "--evidence-out",
        "genithm-v1-rollback-evidence/1",
        "GENITHM_API_IMAGE",
        "CLOUDFLARED_IMAGE",
        "GENITHM_SEQUENCE_WORKER_IMAGE",
        "GENITHM_SOURCE_WORKER_IMAGE",
        "GENITHM_BLAST_WORKER_IMAGE",
        "GENITHM_SCIENTIFIC_WORKER_IMAGE",
        "GENITHM_AUDIT_WORKER_IMAGE",
        "GENITHM_AI_WORKER_IMAGE",
    ]
    for token in required_tokens:
        assert token in rollback, f"missing rollback contract token: {token}"

    assert "production_rollback.py workers" in runbook
    assert "production_rollback.py api" in runbook
    assert "previously approved" in runbook
    assert "rollback evidence" in runbook.lower()
    assert "Production smoke" in runbook or "production smoke" in runbook

    print("PASS: V1 production rollback contract")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
