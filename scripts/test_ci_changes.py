from ci_changes import V1_RELEASE_TRIGGER, classify

WORKERS = ("sequence", "source", "blast", "audit", "scientific", "ai")


def run_tests() -> None:
    result = classify(["docs/notes.md"])
    assert not result["full_ci"]
    assert not result["web"]
    assert not result["api"]
    assert not result["dependency_audit"]
    assert not result["release_required"]
    assert not any(result[f"{worker}_image"] for worker in WORKERS)

    result = classify(["apps/web/app/dashboard/page.tsx"])
    assert result["web"]
    assert not result["api"]
    assert not result["release_required"]
    assert not any(result[f"{worker}_image"] for worker in WORKERS)

    result = classify(["apps/blast-worker/tests/test_runtime.py"])
    assert result["blast_worker"]
    assert not result["blast_image"]
    assert not result["release_required"]

    result = classify(["apps/blast-worker/genithm_blast_worker/runtime.py"])
    assert result["blast_worker"]
    assert result["blast_image"]
    assert result["release_required"]
    assert not result["source_image"]

    result = classify(["apps/ai-worker/pyproject.toml"])
    assert result["ai_worker"]
    assert result["ai_image"]
    assert result["audit_ai"]
    assert result["dependency_audit"]
    assert result["release_required"]

    result = classify([".github/workflows/worker-image.yml"])
    for worker in WORKERS:
        assert result[f"{worker}_image"]
    assert result["release_required"]

    result = classify([".github/workflows/worker-release.yml"])
    assert not result["full_ci"]
    assert not result["release_required"]

    result = classify([".github/workflows/api-release.yml"])
    assert not result["full_ci"]
    assert not result["api"]
    assert not result["dependency_audit"]
    assert not result["release_required"]
    assert not any(result[f"{worker}_image"] for worker in WORKERS)

    result = classify([V1_RELEASE_TRIGGER])
    assert result["full_ci"]
    assert result["web"]
    assert result["api"]
    assert result["dependency_audit"]
    assert result["release_required"]
    for worker in WORKERS:
        assert result[f"{worker}_worker"]
        assert result[f"{worker}_image"]

    result = classify([".github/workflows/ci.yml"])
    assert result["full_ci"]
    assert result["web"]
    assert result["api"]
    assert result["dependency_audit"]
    assert not result["release_required"]
    for worker in WORKERS:
        assert result[f"{worker}_worker"]
        assert not result[f"{worker}_image"]

    result = classify(["new-unclassified-area/config.toml"])
    assert result["full_ci"]
    assert result["web"]
    assert result["api"]
    assert result["dependency_audit"]
    assert result["release_required"]
    for worker in WORKERS:
        assert result[f"{worker}_worker"]
        assert result[f"{worker}_image"]


if __name__ == "__main__":
    run_tests()
    print("CI change classification tests passed")
