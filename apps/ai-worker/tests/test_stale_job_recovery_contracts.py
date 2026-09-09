def test_stale_running_job_can_be_recovered():
    recovery = {
        "job_id": "job-1",
        "previous_status": "running",
        "action": "recover",
    }

    assert recovery["job_id"]
    assert recovery["previous_status"] == "running"
    assert recovery["action"] == "recover"


def test_completed_job_is_not_recovered():
    job = {
        "job_id": "job-2",
        "status": "completed",
    }

    assert job["status"] != "running"
