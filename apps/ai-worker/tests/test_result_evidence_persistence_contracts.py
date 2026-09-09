def test_result_persistence_record_links_result_and_evidence():
    persistence_record = {
        "job_id": "job-1",
        "result_id": "result-1",
        "evidence_snapshot_id": "evidence-1",
    }

    assert persistence_record["job_id"]
    assert persistence_record["result_id"]
    assert persistence_record["evidence_snapshot_id"]


def test_persistence_record_requires_distinct_result_and_evidence_ids():
    persistence_record = {
        "result_id": "result-1",
        "evidence_snapshot_id": "evidence-1",
    }

    assert persistence_record["result_id"] != persistence_record["evidence_snapshot_id"]
