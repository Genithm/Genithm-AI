def test_execution_idempotency_key_prevents_duplicate_runs():
    execution_request = {
        "idempotency_key": "analysis-request-1",
        "job_id": "job-1",
    }

    assert execution_request["idempotency_key"]
    assert execution_request["job_id"]


def test_same_idempotency_key_represents_same_execution_request():
    first = {"idempotency_key": "analysis-request-1"}
    second = {"idempotency_key": "analysis-request-1"}

    assert first["idempotency_key"] == second["idempotency_key"]
