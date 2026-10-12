from __future__ import annotations

"""Read-only verification that the six running workers match an immutable release."""

import argparse
import json
import subprocess
import sys
from pathlib import Path
from typing import Any

from validate_worker_release import EXPECTED_DEPLOYMENTS, validate_release


def check_rollout(manifest: dict[str, Any], cluster: object) -> list[str]:
    failures: list[str] = []
    if not isinstance(cluster, dict) or not isinstance(cluster.get("items"), list):
        return ["kubectl returned an invalid deployment list"]
    found: dict[str, dict[str, Any]] = {}
    for item in cluster["items"]:
        if not isinstance(item, dict):
            failures.append("kubectl returned an invalid deployment")
            continue
        meta = item.get("metadata") or {}
        name = meta.get("name") if isinstance(meta, dict) else None
        if name in EXPECTED_DEPLOYMENTS:
            if name in found:
                failures.append(f"duplicate worker Deployment {name}")
            else:
                found[name] = item

    for entry in manifest["workers"]:
        name = entry["deployment"]
        if name not in found:
            failures.append(f"{name} Deployment is missing")
            continue
        deployment = found[name]
        metadata = deployment.get("metadata") or {}
        spec = deployment.get("spec") or {}
        status = deployment.get("status") or {}
        template = spec.get("template") or {}
        pod_spec = template.get("spec") or {}
        containers = pod_spec.get("containers") or []
        expected_image = entry["image"]

        if len(containers) != 1 or containers[0].get("name") != "worker":
            failures.append(f"{name} must have exactly one named worker container")
        elif containers[0].get("image") != expected_image:
            failures.append(f"{name} image does not match the release SHA-256 digest")

        desired = spec.get("replicas", 1)
        if isinstance(desired, bool) or desired != 1:
            failures.append(f"{name} must request exactly one replica")
        for field in ("readyReplicas", "availableReplicas", "updatedReplicas"):
            if status.get(field, 0) != 1:
                failures.append(f"{name} does not have exactly one {field}")

        generation = metadata.get("generation")
        observed = status.get("observedGeneration")
        if not isinstance(generation, int) or not isinstance(observed, int) or observed < generation:
            failures.append(f"{name} rollout has not observed the latest generation")
    return failures


def fetch_cluster(namespace: str) -> dict[str, Any]:
    try:
        result = subprocess.run(
            ["kubectl", "--namespace", namespace, "get", "deployments", "-o", "json"],
            capture_output=True, text=True, timeout=20, check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise RuntimeError("kubectl could not read the worker namespace") from exc
    if result.returncode != 0:
        raise RuntimeError("kubectl deployment read failed (check context, namespace and RBAC)")
    try:
        payload = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError("kubectl returned invalid JSON") from exc
    if not isinstance(payload, dict):
        raise RuntimeError("kubectl returned a non-object response")
    return payload


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify immutable images and rollout health without changing Kubernetes")
    parser.add_argument("--release-manifest", type=Path, required=True)
    parser.add_argument("--deployment-manifest", type=Path, required=True)
    parser.add_argument("--expected-revision", required=True)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    try:
        manifest = json.loads(args.release_manifest.read_text(encoding="utf-8"))
        deployment = args.deployment_manifest.read_bytes()
        errors = validate_release(manifest, deployment, expected_revision=args.expected_revision)
        if errors:
            raise ValueError("; ".join(errors))
        namespace = manifest["deployment"]["namespace"]
        if namespace != "genithm-workers":
            raise ValueError("release does not target the approved namespace")
        failures = check_rollout(manifest, fetch_cluster(namespace))
    except (OSError, ValueError, KeyError, TypeError, RuntimeError) as exc:
        print(f"worker rollout verification blocked: {exc}", file=sys.stderr)
        return 2

    if args.json:
        print(json.dumps({"ready": not failures, "failures": failures, "release": args.expected_revision}, sort_keys=True))
    else:
        print("Genithm Kubernetes rollout: " + ("PASS" if not failures else "BLOCKED"))
        for failure in failures:
            print(f" - {failure}")
    return 0 if not failures else 2


if __name__ == "__main__":
    raise SystemExit(main())
