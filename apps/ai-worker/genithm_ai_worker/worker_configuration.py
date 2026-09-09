from __future__ import annotations

import os

from .scientific_workflow_registry import get_workflow_handler


class ScientificWorkerConfiguration:
    def __init__(self) -> None:
        self.worker_id = os.environ.get("GENITHM_WORKER_ID", "").strip()
        if not self.worker_id:
            raise ValueError("GENITHM_WORKER_ID is required")

    def resolve_workflow(self, job_type: str):
        return get_workflow_handler(job_type)


__all__ = ["ScientificWorkerConfiguration"]
