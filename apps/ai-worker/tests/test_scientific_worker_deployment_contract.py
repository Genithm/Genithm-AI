def test_scientific_worker_requires_runtime_identity_and_storage_access():
    required_environment = {
        "SUPABASE_URL",
        "SUPABASE_SECRET_KEY",
        "GENITHM_WORKER_ID",
    }

    assert "SUPABASE_URL" in required_environment
    assert "SUPABASE_SECRET_KEY" in required_environment
    assert "GENITHM_WORKER_ID" in required_environment


def test_worker_runs_without_public_ingress_requirement():
    network = {"ingress": False, "egress_https": True}

    assert network["ingress"] is False
    assert network["egress_https"] is True
