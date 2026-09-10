from __future__ import annotations

import unittest
from unittest.mock import patch

import production_smoke


SECURITY_HEADERS = {
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "strict-origin-when-cross-origin",
    "cache-control": "no-store",
}


class ProductionSmokeTests(unittest.TestCase):
    def test_api_release_contract_requires_six_workers_and_nine_queues(self) -> None:
        responses = [
            (200, {"status": "ok", "service": "genithm-api"}, SECURITY_HEADERS),
            (
                200,
                {
                    "status": "ready",
                    "expected_worker_count": 6,
                    "expected_queue_count": 9,
                    "missing_workers": [],
                    "stale_workers": [],
                    "missing_queues": [],
                    "stale_queues": [],
                },
                {},
            ),
        ]
        with patch.object(production_smoke, "_request_json", side_effect=responses):
            results = production_smoke.run_api_checks("https://api.example.test", timeout_seconds=1, attempts=1)
        self.assertTrue(all(result.ok for result in results))

    def test_api_release_contract_fails_when_worker_count_is_wrong(self) -> None:
        responses = [
            (200, {"status": "ok", "service": "genithm-api"}, SECURITY_HEADERS),
            (
                200,
                {
                    "status": "ready",
                    "expected_worker_count": 5,
                    "expected_queue_count": 9,
                    "missing_workers": [],
                    "stale_workers": [],
                    "missing_queues": [],
                    "stale_queues": [],
                },
                {},
            ),
        ]
        with patch.object(production_smoke, "_request_json", side_effect=responses):
            results = production_smoke.run_api_checks("https://api.example.test", timeout_seconds=1, attempts=1)
        readiness = next(result for result in results if result.name == "api_readiness")
        self.assertFalse(readiness.ok)

    def test_api_release_contract_fails_when_worker_is_stale(self) -> None:
        responses = [
            (200, {"status": "ok", "service": "genithm-api"}, SECURITY_HEADERS),
            (
                200,
                {
                    "status": "ready",
                    "expected_worker_count": 6,
                    "expected_queue_count": 9,
                    "missing_workers": [],
                    "stale_workers": ["scientific_worker"],
                    "missing_queues": [],
                    "stale_queues": [],
                },
                {},
            ),
        ]
        with patch.object(production_smoke, "_request_json", side_effect=responses):
            results = production_smoke.run_api_checks("https://api.example.test", timeout_seconds=1, attempts=1)
        readiness = next(result for result in results if result.name == "api_readiness")
        self.assertFalse(readiness.ok)
        self.assertIn("scientific_worker", readiness.detail)

    def test_web_health_requires_exact_service_contract_and_headers(self) -> None:
        with patch.object(
            production_smoke,
            "_request_json",
            return_value=(200, {"status": "ok", "service": "genithm-web"}, SECURITY_HEADERS),
        ):
            results = production_smoke.run_web_checks("https://app.example.test", timeout_seconds=1, attempts=1)
        self.assertTrue(all(result.ok for result in results))


if __name__ == "__main__":
    unittest.main()
