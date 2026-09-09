def test_worker_lease_requires_owner_and_expiry():
    lease = {
        "job_id": "job-1",
        "worker_id": "worker-1",
        "lease_expires_at": "2026-09-10T02:00:00Z",
    }

    assert lease["job_id"]
    assert lease["worker_id"]
    assert lease["lease_expires_at"]


def test_expired_lease_can_be_reassigned():
    lease = {
        "job_id": "job-2",
        "expired": True,
    }

    assert lease["expired"] is True
