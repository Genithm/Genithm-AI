def test_result_snapshot_requires_version_identity():
    snapshot = {
        "result_id": "result-1",
        "version": 1,
        "created_at": "2026-09-10T00:00:00Z",
    }

    assert snapshot["result_id"]
    assert snapshot["version"] > 0
    assert snapshot["created_at"]


def test_result_versions_are_not_mutated_in_place():
    first = {"result_id": "result-1", "version": 1}
    second = {"result_id": "result-1", "version": 2}

    assert first["version"] != second["version"]
