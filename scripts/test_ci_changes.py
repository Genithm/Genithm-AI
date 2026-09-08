from ci_changes import classify


def test_docs_only_is_cheap():
    result = classify(["docs/notes.md"])
    assert not result["full_ci"]
    assert not result["web"]
    assert not result["api"]
    assert not result["dependency_audit"]
    assert not result["release_required"]
    assert not any(result[f"{worker}_image"] for worker in ("sequence", "source", "blast", "audit", "scientific", "ai"))


def test_web_change_runs_web_not_worker_images():
    result = classify(["apps/web/app/dashboard/page.tsx"])
    assert result["web"]
    assert not result["api"]
    assert not result["release_required"]
    assert not any(result[f"{worker}_image"] for worker in ("sequence", "source", "blast", "audit", "scientific", "ai"))


def test_worker_test_change_runs_worker_tests_without_image():
    result = classify(["apps/blast-worker/tests/test_runtime.py"])
    assert result["blast_worker"]
    assert not result["blast_image"]
    assert not result["release_required"]


def test_worker_runtime_change_runs_worker_and_image():
    result = classify(["apps/blast-worker/genithm_blast_worker/runtime.py"])
    assert result["blast_worker"]
    assert result["blast_image"]
    assert result["release_required"]
    assert not result["source_image"]


def test_dependency_change_runs_targeted_audit_and_image():
    result = classify(["apps/ai-worker/pyproject.toml"])
    assert result["ai_worker"]
    assert result["ai_image"]
    assert result["audit_ai"]
    assert result["dependency_audit"]
    assert result["release_required"]


def test_worker_image_workflow_change_runs_all_images():
    result = classify([".github/workflows/worker-image.yml"])
    for worker in ("sequence", "source", "blast", "audit", "scientific", "ai"):
        assert result[f"{worker}_image"]
    assert result["release_required"]


def test_release_workflow_change_requires_release_but_not_all_ci():
    result = classify([".github/workflows/worker-release.yml"])
    assert not result["full_ci"]
    assert result["release_required"]


def test_unknown_path_falls_back_to_full_ci():
    result = classify(["new-unclassified-area/config.toml"])
    assert result["full_ci"]
    assert result["web"]
    assert result["api"]
    assert result["dependency_audit"]
    assert result["release_required"]
    for worker in ("sequence", "source", "blast", "audit", "scientific", "ai"):
        assert result[f"{worker}_worker"]
        assert result[f"{worker}_image"]
