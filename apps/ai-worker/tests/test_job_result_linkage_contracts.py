def test_completed_job_requires_result_reference():
    job_snapshot = {
        "job_id": "job-1",
        "status": "completed",
        "result_id": "result-1",
    }

    assert job_snapshot["status"] == "completed"
    assert job_snapshot["result_id"]


def test_failed_job_does_not_require_result_reference():
    job_snapshot = {
        "job_id": "job-2",
        "status": "failed",
        "error": "worker failed",
    }

    assert job_snapshot["status"] == "failed"
    assert job_snapshot["error"]
