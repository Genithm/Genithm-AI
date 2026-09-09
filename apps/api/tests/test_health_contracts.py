def test_health_contract_is_minimal_and_stable():
    response = {"status": "ok", "service": "genithm-api"}

    assert response["status"] == "ok"
    assert response["service"] == "genithm-api"
    assert set(response) == {"status", "service"}
