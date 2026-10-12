from unittest.mock import patch

import pytest

from genithm_ai_worker import entrypoint


def test_invalid_provider_configuration_never_announces_healthy_worker():
    with (
        patch.object(entrypoint.sys, "argv", ["genithm-ai-worker"]),
        patch.object(entrypoint.Settings, "from_env", side_effect=ValueError("missing provider")) as config,
        patch.object(entrypoint, "start_worker_heartbeat") as heartbeat,
        patch.object(entrypoint, "runtime_main") as main,
    ):
        with pytest.raises(ValueError, match="missing provider"):
            entrypoint.main()
        config.assert_called_once_with()
        heartbeat.assert_not_called()
        main.assert_not_called()


def test_valid_settings_start_heartbeat_before_work_loop():
    calls: list[str] = []

    with (
        patch.object(entrypoint.sys, "argv", ["genithm-ai-worker"]),
        patch.object(entrypoint.Settings, "from_env", side_effect=lambda: calls.append("config")),
        patch.object(entrypoint, "start_worker_heartbeat", side_effect=lambda *_: calls.append("heartbeat")),
        patch.object(entrypoint, "runtime_main", side_effect=lambda: calls.append("runtime")),
    ):
        entrypoint.main()
    assert calls == ["config", "heartbeat", "runtime"]


def test_one_off_invocation_does_not_publish_heartbeat():
    with (
        patch.object(entrypoint.sys, "argv", ["genithm-ai-worker", "--once"]),
        patch.object(entrypoint.Settings, "from_env") as config,
        patch.object(entrypoint, "start_worker_heartbeat") as heartbeat,
        patch.object(entrypoint, "runtime_main") as runtime,
    ):
        entrypoint.main()
        config.assert_not_called()
        heartbeat.assert_not_called()
        runtime.assert_called_once_with()
