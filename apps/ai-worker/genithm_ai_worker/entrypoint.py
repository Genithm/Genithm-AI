from __future__ import annotations

import sys

from .heartbeat import start_worker_heartbeat
from .runtime import USER_AGENT, main as runtime_main

WORKER_KIND = "ai_worker"


def main() -> None:
    if "--once" not in sys.argv[1:]:
        start_worker_heartbeat(WORKER_KIND, USER_AGENT)
    runtime_main()


if __name__ == "__main__":
    main()
