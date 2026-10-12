from __future__ import annotations

import json
import unittest
from unittest.mock import patch

from worker_activation_gate import EXPECTED, MIN_VERSION, READINESS_QUERY, assess, main, parse_version


def snapshot(
    *,
    age: float = 15.0,
    ai_version: str = "genithm-ai-worker/0.5.0",
    scientific_version: str = "genithm-scientific-worker/0.5.0",
) -> dict[str, object]:
    workers = [
        {
            "kind": kind,
            "version": (
                ai_version if kind == "ai"
                else scientific_version if kind == "scientific"
                else f"genithm-{kind}-worker/0.1.0"
            ),
            "age_seconds": age,
        }
        for kind in EXPECTED
    ]
    return {
        "workers": workers,
        "schema": {
            "sequence_schema_applied": True,
            "ai_schema_applied": True,
            "sequence_request_rpc": True,
            "sequence_finish_rpc": True,
            "ai_dispatch_rpc": True,
            "ai_sequence_route": True,
            "actor_binding": True,
        },
    }


class ProductionActivationGateTests(unittest.TestCase):
    def test_all_workers_ready(self) -> None:
        report = assess(snapshot(), stage="workers")
        self.assertTrue(report.ready)
        self.assertEqual(report.workers_fresh, 6)
        self.assertFalse(report.failures)

    def test_all_schema_requirements_ready(self) -> None:
        report = assess(snapshot(), stage="schema")
        self.assertTrue(report.ready)

    def test_missing_worker_fails_closed(self) -> None:
        sample = snapshot()
        sample["workers"] = sample["workers"][:-1]
        report = assess(sample, stage="workers")
        self.assertFalse(report.ready)
        self.assertTrue(any("ai worker heartbeat is missing" in e for e in report.failures))

    def test_stale_heartbeat_fails(self) -> None:
        report = assess(snapshot(age=301), stage="workers")
        self.assertFalse(report.ready)
        self.assertEqual(report.workers_fresh, 0)

    def test_invalid_clock_skew_fails(self) -> None:
        report = assess(snapshot(age=-90), stage="workers")
        self.assertFalse(report.ready)

    def test_ai_worker_must_be_upgraded(self) -> None:
        report = assess(snapshot(ai_version="genithm-ai-worker/0.4.0"), stage="workers")
        self.assertFalse(report.ready)
        self.assertTrue(any("ai worker must report version >=" in e for e in report.failures))

    def test_scientific_worker_must_be_upgraded(self) -> None:
        report = assess(snapshot(scientific_version="genithm-scientific-worker/0.4.0"), stage="workers")
        self.assertFalse(report.ready)
        self.assertTrue(any("scientific worker must report version >=" in e for e in report.failures))

    def test_semver_patch_upgrades_allowed(self) -> None:
        report = assess(snapshot(ai_version="genithm-ai-worker/0.5.3"), stage="workers")
        self.assertTrue(report.ready)

    def test_false_or_missing_schema_field_fails(self) -> None:
        for value in (False, None, "true", 1):
            sample = snapshot()
            sample["schema"]["ai_sequence_route"] = value
            self.assertFalse(assess(sample, stage="schema").ready)

    def test_worker_stage_does_not_require_schema_yet(self) -> None:
        sample = snapshot()
        sample["schema"] = {}
        self.assertTrue(assess(sample, stage="workers").ready)

    def test_deny_duplicate_worker_heartbeats(self) -> None:
        sample = snapshot()
        sample["workers"].append(dict(sample["workers"][0]))
        self.assertFalse(assess(sample, stage="workers").ready)

    def test_bad_worker_data_fails_closed(self) -> None:
        sample = snapshot()
        sample["workers"] = ["invalid", *sample["workers"]]
        self.assertFalse(assess(sample, stage="workers").ready)

    def test_reject_non_object_snapshot(self) -> None:
        self.assertFalse(assess(None, stage="workers").ready)

    def test_reject_invalid_staleness_threshold(self) -> None:
        for seconds in (0, 20, 1000, True):
            with self.assertRaises(ValueError):
                assess(snapshot(), stage="workers", stale_after_seconds=seconds)

    def test_workers_have_expected_minimums(self) -> None:
        self.assertEqual(MIN_VERSION, {"scientific": (0, 5, 0), "ai": (0, 5, 0)})
        self.assertEqual(parse_version("genithm-ai-worker/0.5.0", "ai"), (0, 5, 0))
        self.assertIsNone(parse_version("unexpected-worker/0.5.0", "ai"))

    def test_sql_only_exposes_operational_status(self) -> None:
        self.assertIn("app_private.worker_runtime_heartbeats", READINESS_QUERY)
        self.assertIn("supabase_migrations.schema_migrations", READINESS_QUERY)
        self.assertNotIn("select *", READINESS_QUERY.lower())
        self.assertNotIn("sequence_uploads", READINESS_QUERY)
        self.assertNotIn("service_role", READINESS_QUERY)

    @patch("worker_activation_gate.query_database", return_value=snapshot())
    @patch("sys.argv", ["worker_activation_gate.py", "--stage", "schema", "--json"])
    def test_json_cli(self, _query) -> None:
        with patch("builtins.print") as output:
            self.assertEqual(main(), 0)
            result = json.loads(output.call_args.args[0])
        self.assertTrue(result["ready"])
        self.assertEqual(result["workers_fresh"], 6)

    @patch("worker_activation_gate.query_database", side_effect=RuntimeError("database unavailable"))
    @patch("sys.argv", ["worker_activation_gate.py", "--stage", "workers"])
    def test_connection_errors_fail_closed(self, _query) -> None:
        self.assertEqual(main(), 2)


if __name__ == "__main__":
    unittest.main()
