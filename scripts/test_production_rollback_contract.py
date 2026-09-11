from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    rollback = (ROOT / "scripts/production_rollback.py").read_text(encoding="utf-8")
    runbook = (ROOT / "docs/deployment/PRODUCTION_LAUNCH_V1.md").read_text(encoding="utf-8")

    required = [
        "render_v1_deployment_env",
        "source_revision",
        "--expected-source-sha",
        "--bundle",
        "--confirm",
        "ROLLBACK",
        "oracle_deploy_preflight.py",
        '"pull"',
        '"up", "-d", "--remove-orphans"',
        '"ps"',
        "GENITHM_API_IMAGE",
        "GENITHM_CLOUDFLARED_IMAGE",
        "GENITHM_SEQUENCE_WORKER_IMAGE",
        "GENITHM_SOURCE_WORKER_IMAGE",
        "GENITHM_BLAST_WORKER_IMAGE",
        "GENITHM_SCIENTIFIC_WORKER_IMAGE",
        "GENITHM_AUDIT_WORKER_IMAGE",
        "GENITHM_AI_WORKER_IMAGE",
        "genithm-v1-rollback-evidence/1",
        "release_bundle_sha256",
    ]
    for token in required:
        assert token in rollback, f"missing rollback contract token: {token}"

    assert "production_rollback.py" in runbook
    assert "--bundle" in runbook
    assert "--confirm ROLLBACK" in runbook
    assert "rollback drill" in runbook.lower()
    assert "previously approved digest-pinned" in runbook.lower()

    print("PASS: V1 production rollback contract")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
