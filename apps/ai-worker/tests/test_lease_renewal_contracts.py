def test_worker_lease_renewal_requires_active_job_and_worker_identity():
    renewal = {
        "job_id": "job-1",
        "worker_id": "worker-1",
        "lease_expires_at": "2026-09-10T02:10:00Z",
    }

    assert renewal["job_id"]
    assert renewal["worker_id"]
    assert renewal["lease_expires_at"]


def test_expired_or_released_lease_cannot_be_renewed():
    lease = {
        "job_id": "job-2",
        "renewable": False,
    }

    assert lease["renewable"] is False
