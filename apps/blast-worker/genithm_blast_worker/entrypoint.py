from __future__ import annotations

import sys

from .heartbeat import start_worker_heartbeat
from .runtime import main as runtime_main

WORKER_KIND = "blast_worker"
WORKER_VERSION = "genithm-blast-worker/0.1.0"


def main() -> int:
    if "--once" not in sys.argv[1:]:
        start_worker_heartbeat(WORKER_KIND, WORKER_VERSION)
    return runtime_main()


if __name__ == "__main__":
    raise SystemExit(main())
