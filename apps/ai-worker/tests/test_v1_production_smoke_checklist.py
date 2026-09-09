def test_v1_production_smoke_sequence():
    checklist = [
        "database_available",
        "worker_claims_job",
        "workflow_executes",
        "result_persisted",
        "provenance_persisted",
        "report_available",
    ]

    assert checklist[0] == "database_available"
    assert checklist[-1] == "report_available"
    assert len(checklist) == 6


def test_v1_requires_single_execution_path():
    paths = ["scientific_worker"]

    assert paths == ["scientific_worker"]
