from __future__ import annotations

import sys

from .heartbeat import start_worker_heartbeat
from .runtime_v4 import WORKER_VERSION, main as runtime_main

WORKER_KIND = "scientific_worker"


def main() -> int:
    if "--once" not in sys.argv[1:]:
        start_worker_heartbeat(WORKER_KIND, WORKER_VERSION)
    return runtime_main()


if __name__ == "__main__":
    raise SystemExit(main())
