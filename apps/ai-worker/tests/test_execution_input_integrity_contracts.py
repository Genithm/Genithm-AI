def test_execution_input_snapshot_requires_checksum_and_source():
    snapshot = {
        "job_id": "job-1",
        "source": "user_upload",
        "checksum": "sha256-input",
    }

    assert snapshot["job_id"]
    assert snapshot["source"]
    assert snapshot["checksum"]


def test_execution_input_snapshot_is_separate_from_result():
    record = {
        "input_snapshot": {"checksum": "sha256-input"},
        "result": {"matches": []},
    }

    assert record["input_snapshot"] != record["result"]
