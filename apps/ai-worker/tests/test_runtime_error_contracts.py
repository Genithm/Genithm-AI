from genithm_ai_worker.runtime import ProviderHttpError


def test_retryable_provider_errors_are_marked_for_transient_failures():
    error = ProviderHttpError("temporary outage", retryable=True)
    assert error.retryable is True


def test_non_retryable_provider_errors_are_marked_for_invalid_responses():
    error = ProviderHttpError("invalid response", retryable=False)
    assert error.retryable is False
