from __future__ import annotations

import os


REQUIRED_WORKER_ENV = {
    "SUPABASE_URL",
    "SUPABASE_SECRET_KEY",
}


class ReleaseValidationError(Exception):
    pass


def validate_worker_environment() -> None:
    missing = [key for key in REQUIRED_WORKER_ENV if not os.environ.get(key)]
    if missing:
        raise ReleaseValidationError(
            "Missing required worker environment: " + ", ".join(sorted(missing))
        )


def validate_scientific_worker_identity() -> None:
    if not os.environ.get("GENITHM_WORKER_ID"):
        raise ReleaseValidationError("GENITHM_WORKER_ID is required")


def validate_v1_release_environment() -> None:
    validate_worker_environment()
    validate_scientific_worker_identity()


if __name__ == "__main__":
    validate_v1_release_environment()
    print("Genithm V1 release environment validation passed")
