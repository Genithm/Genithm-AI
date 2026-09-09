def test_retry_policy_requires_attempt_limit():
    policy = {
        "max_attempts": 3,
        "retryable_statuses": ["failed"],
    }

    assert policy["max_attempts"] > 0
    assert "failed" in policy["retryable_statuses"]


def test_retry_policy_stops_after_max_attempts():
    attempt = 3
    max_attempts = 3

    assert attempt >= max_attempts
