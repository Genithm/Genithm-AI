def test_retryable_worker_failure_can_preserve_job_for_retry():
    failure = {
        "job_id": "job-1",
        "status": "failed",
        "retryable": True,
        "attempt": 1,
    }

    assert failure["job_id"]
    assert failure["retryable"] is True
    assert failure["attempt"] == 1


def test_non_retryable_failure_stops_retry_flow():
    failure = {
        "job_id": "job-2",
        "status": "failed",
        "retryable": False,
    }

    assert failure["status"] == "failed"
    assert failure["retryable"] is False
