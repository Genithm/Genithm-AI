from __future__ import annotations

import time
from typing import Any

from .scientific_dispatcher import ScientificDispatcher
from .scientific_job_runtime import ScientificJobRuntime
from .scientific_worker_loop import ScientificWorkerLoop
from .scientific_workflow_registry import SCIENTIFIC_WORKFLOW_HANDLERS


class RpcClientProtocol:
    def rpc(self, name: str, payload: dict[str, Any]) -> Any:  # pragma: no cover
        raise NotImplementedError


def run_worker(rpc_client: RpcClientProtocol, poll_seconds: float = 2.0) -> None:
    runtime = ScientificJobRuntime(rpc_client)
    dispatcher = ScientificDispatcher(SCIENTIFIC_WORKFLOW_HANDLERS)
    loop = ScientificWorkerLoop(runtime, dispatcher)

    while True:
        worked = loop.run_once()
        if not worked:
            time.sleep(poll_seconds)
