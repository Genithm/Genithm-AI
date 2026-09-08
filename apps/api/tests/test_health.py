from fastapi.testclient import TestClient

import app.main as main

client = TestClient(main.app)


def test_health() -> None:
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "genithm-api"}
    assert response.headers["x-content-type-options"] == "nosniff"


def test_readiness_without_runtime_dependency_config() -> None:
    response = client.get("/api/v1/ready")
    assert response.status_code == 200
    assert response.json() == {"status": "ready", "dependency_check": "skipped_not_configured"}


def test_readiness_returns_503_when_dependency_is_not_ready(monkeypatch) -> None:
    monkeypatch.setattr(
        main,
        "_fetch_release_readiness",
        lambda: {
            "status": "not_ready",
            "missing_queues": [],
            "stale_queues": ["ai_planning"],
            "total_backlog": 1,
        },
    )

    response = client.get("/api/v1/ready")

    assert response.status_code == 503
    assert response.json()["status"] == "not_ready"
    assert response.json()["stale_queues"] == ["ai_planning"]


def test_readiness_returns_bounded_dependency_metrics(monkeypatch) -> None:
    monkeypatch.setattr(
        main,
        "_fetch_release_readiness",
        lambda: {
            "status": "ready",
            "expected_queue_count": 9,
            "missing_queues": [],
            "stale_queues": [],
            "total_backlog": 0,
            "max_oldest_message_age_seconds": None,
            "checked_at": "2026-09-08T00:00:00+00:00",
        },
    )

    response = client.get("/api/v1/ready")
    payload = response.json()

    assert response.status_code == 200
    assert payload["expected_queue_count"] == 9
    assert set(payload) == {
        "status",
        "expected_queue_count",
        "missing_queues",
        "stale_queues",
        "total_backlog",
        "max_oldest_message_age_seconds",
        "checked_at",
    }
