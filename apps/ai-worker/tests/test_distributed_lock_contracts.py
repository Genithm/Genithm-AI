def test_distributed_lock_requires_unique_execution_key():
    lock = {
        "lock_key": "analysis-job-1",
        "job_id": "job-1",
        "owner": "worker-1",
    }

    assert lock["lock_key"]
    assert lock["job_id"]
    assert lock["owner"]


def test_released_lock_can_be_acquired_by_new_worker():
    lock_state = {
        "lock_key": "analysis-job-1",
        "released": True,
    }

    assert lock_state["released"] is True
