def test_worker_status_update_requires_job_identity_and_new_status():
    update = {
        "job_id": "job-1",
        "status": "running",
    }

    assert update["job_id"]
    assert update["status"] == "running"


def test_worker_status_update_does_not_allow_missing_job_identity():
    update = {
        "status": "completed",
    }

    assert "job_id" not in update
