from __future__ import annotations

import copy
import json
import unittest
from unittest.mock import patch

from test_validate_worker_release import fixture as release_fixture
from verify_worker_rollout import check_rollout, fetch_cluster, main


def cluster_fixture(manifest: dict[str, object]) -> dict[str, object]:
    return {
        "items": [
            {
                "metadata": {"name": entry["deployment"], "generation": 4},
                "spec": {
                    "replicas": 1,
                    "template": {"spec": {"containers": [
                        {"name": "worker", "image": entry["image"]}
                    ]}},
                },
                "status": {
                    "observedGeneration": 4,
                    "readyReplicas": 1,
                    "availableReplicas": 1,
                    "updatedReplicas": 1,
                },
            }
            for entry in manifest["workers"]
        ]
    }


class WorkerRolloutValidationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.manifest, self.deployment = release_fixture()
        self.cluster = cluster_fixture(self.manifest)

    def test_valid_six_worker_rollout(self) -> None:
        self.assertEqual(check_rollout(self.manifest, self.cluster), [])

    def test_reject_image_digest_drift(self) -> None:
        cluster = copy.deepcopy(self.cluster)
        cluster["items"][0]["spec"]["template"]["spec"]["containers"][0]["image"] = "ghcr.io/bad@sha256:" + "f" * 64
        self.assertTrue(any("image does not match" in error for error in check_rollout(self.manifest, cluster)))

    def test_reject_missing_deployment(self) -> None:
        cluster = copy.deepcopy(self.cluster)
        cluster["items"].pop()
        self.assertTrue(any("Deployment is missing" in error for error in check_rollout(self.manifest, cluster)))

    def test_reject_unready_or_unobserved_rollouts(self) -> None:
        cluster = copy.deepcopy(self.cluster)
        cluster["items"][0]["status"]["readyReplicas"] = 0
        cluster["items"][1]["status"]["observedGeneration"] = 3
        issues = check_rollout(self.manifest, cluster)
        self.assertTrue(any("readyReplicas" in error for error in issues))
        self.assertTrue(any("latest generation" in error for error in issues))

    def test_reject_scale_to_zero(self) -> None:
        cluster = copy.deepcopy(self.cluster)
        cluster["items"][0]["spec"]["replicas"] = 0
        self.assertTrue(any("exactly one replica" in issue for issue in check_rollout(self.manifest, cluster)))

    def test_invalid_or_duplicate_cluster_result(self) -> None:
        self.assertFalse(check_rollout(self.manifest, self.cluster))
        bad = copy.deepcopy(self.cluster)
        bad["items"].append(copy.deepcopy(bad["items"][0]))
        self.assertTrue(any("duplicate worker Deployment" in issue for issue in check_rollout(self.manifest, bad)))
        self.assertEqual(check_rollout(self.manifest, None), ["kubectl returned an invalid deployment list"])

    @patch("verify_worker_rollout.subprocess.run")
    def test_kubectl_read_uses_no_mutating_verbs(self, run) -> None:
        run.return_value.returncode = 0
        run.return_value.stdout = json.dumps(self.cluster)
        self.assertEqual(fetch_cluster("genithm-workers"), self.cluster)
        argv = run.call_args.args[0]
        self.assertEqual(argv, ["kubectl", "--namespace", "genithm-workers", "get", "deployments", "-o", "json"])
        self.assertNotIn("apply", argv)
        self.assertNotIn("delete", argv)


if __name__ == "__main__":
    unittest.main()
