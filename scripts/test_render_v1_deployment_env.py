from __future__ import annotations

from copy import deepcopy

from render_v1_deployment_env import EXPECTED_WORKERS, render_env

DIGEST = "a" * 64


def _bundle() -> dict:
    return {
        "schema_version": "genithm-v1-release/1",
        "release_target": "v1.0.0",
        "stage": "deployment_candidate",
        "images": {
            "api": f"ghcr.io/genithm/genithm-api@sha256:{DIGEST}",
            "cloudflared": f"docker.io/cloudflare/cloudflared@sha256:{DIGEST}",
            "workers": {
                worker: f"ghcr.io/genithm/genithm-{worker}-worker@sha256:{str(index + 1) * 64}"
                for index, worker in enumerate(EXPECTED_WORKERS)
            },
        },
    }


def _expect_failure(bundle: dict, text: str) -> None:
    try:
        render_env(bundle)
    except ValueError as exc:
        assert text in str(exc)
    else:
        raise AssertionError(f"expected failure containing: {text}")


def run_tests() -> None:
    rendered = render_env(_bundle())
    assert "GENITHM_API_IMAGE=ghcr.io/genithm/genithm-api@sha256:" in rendered
    assert "GENITHM_CLOUDFLARED_IMAGE=docker.io/cloudflare/cloudflared@sha256:" in rendered
    assert "GENITHM_SEQUENCE_WORKER_IMAGE=" in rendered
    assert "GENITHM_AI_WORKER_IMAGE=" in rendered
    assert "SUPABASE_SECRET_KEY" not in rendered
    assert "GENITHM_R2_SECRET_ACCESS_KEY" not in rendered

    bundle = deepcopy(_bundle())
    del bundle["images"]["workers"]["ai"]
    _expect_failure(bundle, "six expected workers")

    bundle = deepcopy(_bundle())
    bundle["images"]["api"] = "ghcr.io/genithm/genithm-api:latest"
    _expect_failure(bundle, "API image must be a digest-pinned image reference")

    bundle = deepcopy(_bundle())
    bundle["stage"] = "released"
    _expect_failure(bundle, "deployment candidate")


if __name__ == "__main__":
    run_tests()
    print("V1 deployment handoff renderer tests passed")
