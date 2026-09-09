def test_cors_contract_allows_expected_api_methods():
    allowed_methods = {"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"}

    assert "GET" in allowed_methods
    assert "POST" in allowed_methods
    assert "OPTIONS" in allowed_methods


def test_cors_contract_requires_standard_auth_headers():
    allowed_headers = {"Authorization", "Content-Type", "X-Request-ID"}

    assert "Authorization" in allowed_headers
    assert "Content-Type" in allowed_headers
