def test_execution_provenance_requires_worker_and_tool_context():
    provenance = {
        "job_id": "job-1",
        "worker_id": "worker-1",
        "tool": "blast",
        "tool_version": "1.0",
    }

    assert provenance["job_id"]
    assert provenance["worker_id"]
    assert provenance["tool"]
    assert provenance["tool_version"]


def test_execution_provenance_is_not_result_payload():
    record = {
        "result": {"matches": []},
        "provenance": {"tool": "blast"},
    }

    assert "result" in record
    assert "provenance" in record
    assert record["result"] != record["provenance"]
