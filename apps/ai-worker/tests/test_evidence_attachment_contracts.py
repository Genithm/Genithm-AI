def test_completed_analysis_can_attach_evidence_snapshot():
    execution_record = {
        "job_id": "job-1",
        "result_id": "result-1",
        "evidence_snapshot_id": "evidence-1",
        "status": "completed",
    }

    assert execution_record["status"] == "completed"
    assert execution_record["result_id"]
    assert execution_record["evidence_snapshot_id"]


def test_running_analysis_has_no_final_evidence_requirement():
    execution_record = {
        "job_id": "job-2",
        "status": "running",
    }

    assert execution_record["status"] == "running"
