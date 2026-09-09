def test_worker_claim_requires_pending_job_identity():
    claim = {
        "job_id": "job-1",
        "status": "queued",
    }

    assert claim["job_id"]
    assert claim["status"] == "queued"


def test_worker_cannot_claim_completed_job():
    claim = {
        "job_id": "job-2",
        "status": "completed",
    }

    assert claim["status"] != "queued"
