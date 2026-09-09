from __future__ import annotations

from typing import Any, Callable

from .scientific_job_runtime import ScientificJobRuntime


class ScientificDispatcher:
    """Dispatches claimed scientific jobs to registered workflow handlers."""

    def __init__(self, runtime: ScientificJobRuntime, handlers: dict[str, Callable[[dict[str, Any]], dict[str, Any]]]):
        self.runtime = runtime
        self.handlers = handlers

    def run_once(self) -> bool:
        job = self.runtime.claim_job()
        if job is None:
            return False

        job_id = str(job["job_id"])
        message_id = int(job["message_id"])
        job_type = str(job["job_type"])

        handler = self.handlers.get(job_type)
        if handler is None:
            self.runtime.fail(
                message_id=message_id,
                job_id=job_id,
                failure_class="input_integrity",
                processing_error=f"Unsupported scientific job type: {job_type}",
                retryable=False,
            )
            return True

        try:
            result = handler({
                "parameters": job.get("parameters", {}),
                "inputs": job.get("inputs", []),
            })
            self.runtime.complete(
                message_id=message_id,
                job_id=job_id,
                executor_version="scientific-dispatcher-v1",
                result_object_path="inline://scientific-result",
                result_sha256=str(result.get("sha256", "")),
                result_bytes=int(result.get("bytes", 0)),
                result_summary=result,
                provenance={
                    "job_type": job_type,
                    "executor": "scientific-dispatcher-v1",
                },
            )
        except Exception as exc:
            self.runtime.fail(
                message_id=message_id,
                job_id=job_id,
                failure_class="execution",
                processing_error=str(exc),
                retryable=True,
            )
        return True
