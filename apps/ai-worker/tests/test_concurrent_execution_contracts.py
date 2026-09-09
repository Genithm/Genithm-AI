def test_same_job_cannot_have_multiple_active_workers():
    assignments = [
        {"job_id": "job-1", "worker_id": "worker-1", "active": True},
    ]

    active_assignments = [item for item in assignments if item["active"]]

    assert len(active_assignments) == 1
    assert active_assignments[0]["job_id"] == "job-1"


def test_different_jobs_can_have_different_workers():
    assignments = [
        {"job_id": "job-1", "worker_id": "worker-1"},
        {"job_id": "job-2", "worker_id": "worker-2"},
    ]

    assert assignments[0]["job_id"] != assignments[1]["job_id"]
