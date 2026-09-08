from __future__ import annotations

import sys

from .heartbeat import start_worker_heartbeat
from .runtime import main as runtime_main

WORKER_KIND = "audit_worker"
WORKER_VERSION = "genithm-audit-worker/0.1.0"


def _is_continuous_run(args: list[str]) -> bool:
    return not any(arg in {"--once", "--help", "-h"} for arg in args)


def main() -> None:
    if _is_continuous_run(sys.argv[1:]):
        start_worker_heartbeat(WORKER_KIND, WORKER_VERSION)
    runtime_main()


if __name__ == "__main__":
    main()
