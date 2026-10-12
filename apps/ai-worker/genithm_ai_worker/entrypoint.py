from __future__ import annotations

import sys

from .heartbeat import start_worker_heartbeat
from .runtime import USER_AGENT, Settings, main as runtime_main

WORKER_KIND = "ai_worker"


def _is_continuous_run(args: list[str]) -> bool:
    return not any(arg in {"--once", "--help", "-h"} for arg in args)


def main() -> None:
    if _is_continuous_run(sys.argv[1:]):
        # Do not publish an apparently healthy heartbeat for an invalid
        # provider configuration that would immediately crash the worker.
        Settings.from_env()
        start_worker_heartbeat(WORKER_KIND, USER_AGENT)
    runtime_main()


if __name__ == "__main__":
    main()
