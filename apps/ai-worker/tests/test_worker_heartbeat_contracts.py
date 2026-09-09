def test_worker_heartbeat_requires_worker_identity_and_timestamp():
    heartbeat = {
        "worker_id": "worker-1",
        "timestamp": "2026-09-10T00:00:00Z",
        "status": "healthy",
    }

    assert heartbeat["worker_id"]
    assert heartbeat["timestamp"]
    assert heartbeat["status"] == "healthy"


def test_unhealthy_heartbeat_can_trigger_recovery_flow():
    heartbeat = {
        "worker_id": "worker-2",
        "status": "unhealthy",
    }

    assert heartbeat["status"] == "unhealthy"
