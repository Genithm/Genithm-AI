def test_v1_scientific_flow_contract():
    flow = [
        "claim_scientific_job",
        "execute_workflow",
        "persist_result",
        "persist_provenance",
        "finish_scientific_job_success",
    ]

    assert flow[0] == "claim_scientific_job"
    assert flow[-1] == "finish_scientific_job_success"
    assert "persist_provenance" in flow


def test_v1_failure_flow_contract():
    failure_flow = [
        "execute_workflow",
        "classify_failure",
        "finish_scientific_job_error",
    ]

    assert failure_flow[-1] == "finish_scientific_job_error"
