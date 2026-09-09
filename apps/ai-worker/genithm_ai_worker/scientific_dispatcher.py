from __future__ import annotations

from typing import Any, Callable


class ScientificDispatcher:
    """Dispatches one already-claimed scientific job to its handler.

    Claiming and persistence are intentionally owned by ScientificWorkerLoop so
    each job has a single orchestration authority.
    """

    def __init__(self, handlers: dict[str, Callable[[dict[str, Any]], dict[str, Any]]]):
        self.handlers = handlers

    def execute(self, job: dict[str, Any]) -> dict[str, Any]:
        job_type = str(job["job_type"])
        handler = self.handlers.get(job_type)
        if handler is None:
            raise ValueError(f"Unsupported scientific job type: {job_type}")

        result = handler({
            "parameters": job.get("parameters", {}),
            "inputs": job.get("inputs", []),
        })
        if not isinstance(result, dict):
            raise RuntimeError("scientific handler returned an invalid result")
        return result
