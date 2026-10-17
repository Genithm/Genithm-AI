from __future__ import annotations

import sys

from .heartbeat import start_worker_heartbeat
from .runtime_v4 import WORKER_VERSION, main as runtime_main

WORKER_KIND = "scientific_worker"


def _is_continuous_run(args: list[str]) -> bool:
    return not any(arg in {"--once", "--help", "-h"} for arg in args)


def main() -> int:
    heartbeat = None
    if _is_continuous_run(sys.argv[1:]):
        heartbeat = start_worker_heartbeat(WORKER_KIND, WORKER_VERSION)
    try:
        return runtime_main()
    finally:
        if heartbeat is not None:
            heartbeat.set()


if __name__ == "__main__":
    raise SystemExit(main())
