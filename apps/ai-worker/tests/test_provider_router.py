import pytest

from genithm_ai_worker.providers import ProviderHttpError, ProviderRouter


class FakeProvider:
    def __init__(self, name: str, model: str, outcomes):
        self.name = name
        self.model = model
        self.outcomes = list(outcomes)
        self.calls = 0

    def structured_response(self, **_kwargs):
        self.calls += 1
        outcome = self.outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome


def test_primary_provider_handles_request_without_backup():
    primary = FakeProvider("qwen", "qwen-test", [{"ok": True}])
    backup = FakeProvider("deepseek", "deepseek-test", [{"ok": True}])
    router = ProviderRouter(primary, backup)

    result = router.run(lambda provider: provider.structured_response())

    assert result == {"ok": True}
    assert primary.calls == 1
    assert backup.calls == 0
    assert router.last_provider == "qwen"
    assert router.last_model == "qwen-test"


def test_transient_primary_failure_falls_back_to_backup():
    primary = FakeProvider(
        "qwen",
        "qwen-test",
        [ProviderHttpError("temporary outage", retryable=True, fallback_allowed=True)],
    )
    backup = FakeProvider("deepseek", "deepseek-test", [{"ok": True}])
    router = ProviderRouter(primary, backup)

    result = router.run(lambda provider: provider.structured_response())

    assert result == {"ok": True}
    assert primary.calls == 1
    assert backup.calls == 1
    assert router.last_provider == "deepseek"
    assert router.last_model == "deepseek-test"


def test_non_fallback_failure_stops_at_primary():
    primary = FakeProvider(
        "qwen",
        "qwen-test",
        [ProviderHttpError("authentication failed", retryable=False, fallback_allowed=False)],
    )
    backup = FakeProvider("deepseek", "deepseek-test", [{"ok": True}])
    router = ProviderRouter(primary, backup)

    with pytest.raises(ProviderHttpError, match="authentication failed"):
        router.run(lambda provider: provider.structured_response())

    assert primary.calls == 1
    assert backup.calls == 0


def test_router_rejects_same_provider_as_primary_and_backup():
    primary = FakeProvider("qwen", "qwen-a", [{"ok": True}])
    backup = FakeProvider("qwen", "qwen-b", [{"ok": True}])

    with pytest.raises(ValueError, match="must be different"):
        ProviderRouter(primary, backup)
