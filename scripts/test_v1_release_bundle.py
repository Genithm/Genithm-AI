from __future__ import annotations

from copy import deepcopy

from build_v1_release_bundle import EXPECTED_WEB_CONTRACT, EXPECTED_WORKERS, build_bundle

REVISION = "a" * 40
DIGEST = "b" * 64


def _candidate() -> dict:
    return {
        "schema_version": "genithm-v1-candidate/1",
        "release_target": "v1.0.0",
        "stage": "deployment_candidate",
        "repository": "Genithm/Genithm-AI",
        "platforms": ["linux/amd64", "linux/arm64"],
        "web_contract": deepcopy(EXPECTED_WEB_CONTRACT),
        "cloudflared": {
            "version": "2026.9.0",
            "image": f"docker.io/cloudflare/cloudflared@sha256:{DIGEST}",
        },
        "runtime_contract": {"expected_workers": 6, "expected_queues": 9},
    }


def _api() -> dict:
    return {
        "schema_version": 1,
        "repository": "Genithm/Genithm-AI",
        "source_revision": REVISION,
        "platforms": ["linux/amd64", "linux/arm64"],
        "image": f"ghcr.io/genithm/genithm-api@sha256:{DIGEST}",
    }


def _workers() -> dict:
    return {
        "schema_version": "genithm-worker-release/1",
        "source": {"repository": "Genithm/Genithm-AI", "commit_sha": REVISION},
        "platforms": ["linux/amd64", "linux/arm64"],
        "workers": [
            {
                "worker": worker,
                "image": f"ghcr.io/genithm/genithm-{worker}-worker@sha256:{str(index + 1) * 64}",
            }
            for index, worker in enumerate(EXPECTED_WORKERS)
        ],
    }


def _expect_failure(candidate: dict, api: dict, workers: dict, text: str) -> None:
    try:
        build_bundle(candidate, api, workers)
    except ValueError as exc:
        assert text in str(exc)
    else:
        raise AssertionError(f"expected failure containing: {text}")


def run_tests() -> None:
    bundle = build_bundle(_candidate(), _api(), _workers())
    assert bundle["release_target"] == "v1.0.0"
    assert bundle["source_revision"] == REVISION
    assert bundle["web_contract"] == EXPECTED_WEB_CONTRACT
    assert list(bundle["images"]["workers"]) == list(EXPECTED_WORKERS)
    assert bundle["verification"]["cloudflare_web_contract_required"] is True
    assert bundle["verification"]["tag_allowed_only_after_live_gates"] is True

    api = _api()
    api["source_revision"] = "c" * 40
    _expect_failure(_candidate(), api, _workers(), "revisions do not match")

    workers = _workers()
    workers["workers"] = workers["workers"][:-1]
    _expect_failure(_candidate(), _api(), workers, "exactly six workers")

    workers = _workers()
    workers["workers"][1]["worker"] = workers["workers"][0]["worker"]
    _expect_failure(_candidate(), _api(), workers, "missing, duplicate, or unknown workers")

    candidate = deepcopy(_candidate())
    candidate["cloudflared"]["image"] = "cloudflare/cloudflared:latest"
    _expect_failure(candidate, _api(), _workers(), "cloudflared image must be digest pinned")

    candidate = deepcopy(_candidate())
    candidate["web_contract"]["free_plan_max_gzip_kib"] = 4096
    _expect_failure(candidate, _api(), _workers(), "approved Cloudflare Workers Free runtime")

    candidate = _candidate()
    candidate["release_target"] = "v2.0.0"
    _expect_failure(candidate, _api(), _workers(), "release_target must be v1.0.0")


if __name__ == "__main__":
    run_tests()
    print("V1 release bundle contract tests passed")
