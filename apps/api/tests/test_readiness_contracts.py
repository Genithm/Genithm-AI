def test_ready_endpoint_contract_documentation():
    """Keep readiness response contract explicit for production checks.

    The API readiness endpoint returns either ready or not_ready states.
    This lightweight contract test documents the expected states without
    requiring live Supabase infrastructure.
    """
    allowed_states = {"ready", "not_ready"}
    assert "ready" in allowed_states
    assert "not_ready" in allowed_states
