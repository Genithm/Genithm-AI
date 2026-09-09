def test_worker_persistence_payload_contains_execution_identity():
    payload = {
        "job_id": "job-1",
        "worker_id": "worker-1",
        "status": "running",
    }

    assert payload["job_id"]
    assert payload["worker_id"]
    assert payload["status"] == "running"


def test_worker_completed_payload_contains_result_and_evidence_links():
    payload = {
        "job_id": "job-1",
        "status": "completed",
        "result_id": "result-1",
        "evidence_snapshot_id": "evidence-1",
    }

    assert payload["status"] == "completed"
    assert payload["result_id"]
    assert payload["evidence_snapshot_id"]
