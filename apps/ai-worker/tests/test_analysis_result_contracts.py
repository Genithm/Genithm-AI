def build_result_snapshot():
    return {
        "schema_version": "analysis-result-v1",
        "status": "completed",
        "result": {},
        "provenance": {},
    }


def test_completed_analysis_result_requires_snapshot_contract():
    snapshot = build_result_snapshot()

    assert snapshot["schema_version"] == "analysis-result-v1"
    assert snapshot["status"] == "completed"
    assert "provenance" in snapshot


def test_result_snapshot_keeps_provenance_separate_from_result():
    snapshot = build_result_snapshot()

    assert "provenance" not in snapshot["result"]
    assert "result" not in snapshot["provenance"]
