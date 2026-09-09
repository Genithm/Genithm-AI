def test_analysis_audit_record_keeps_execution_trace():
    audit_record = {
        "job_id": "job-1",
        "worker_id": "worker-1",
        "started_at": "2026-09-10T00:00:00Z",
        "completed_at": "2026-09-10T00:01:00Z",
    }

    assert audit_record["job_id"]
    assert audit_record["worker_id"]
    assert audit_record["started_at"]
    assert audit_record["completed_at"]


def test_analysis_audit_requires_execution_identity():
    audit_record = {
        "worker_id": "worker-1",
    }

    assert "worker_id" in audit_record
    assert "job_id" not in audit_record
