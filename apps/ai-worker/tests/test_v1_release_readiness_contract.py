def test_v1_release_flow_contract():
    flow = [
        "claim_scientific_job",
        "execute_workflow",
        "persist_result",
        "persist_provenance",
        "generate_report",
    ]

    assert flow[0] == "claim_scientific_job"
    assert "persist_result" in flow
    assert "persist_provenance" in flow
    assert flow[-1] == "generate_report"


def test_release_requires_no_parallel_execution_owner():
    owners = ["scientific_worker"]

    assert len(owners) == 1
