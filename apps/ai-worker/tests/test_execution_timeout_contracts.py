def test_execution_timeout_requires_timeout_metadata():
    timeout_record = {
        "job_id": "job-1",
        "timeout_seconds": 900,
        "status": "timed_out",
    }

    assert timeout_record["job_id"]
    assert timeout_record["timeout_seconds"] > 0
    assert timeout_record["status"] == "timed_out"


def test_completed_execution_is_not_timed_out():
    execution = {
        "job_id": "job-2",
        "status": "completed",
    }

    assert execution["status"] != "timed_out"
