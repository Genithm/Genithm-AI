from __future__ import annotations

from typing import Any

from .scientific_dispatcher import ScientificDispatcher
from .scientific_job_runtime import ScientificJobRuntime


class ScientificWorkerLoop:
    """Runs one controlled scientific job execution cycle."""

    def __init__(self, runtime: ScientificJobRuntime, dispatcher: ScientificDispatcher):
        self.runtime = runtime
        self.dispatcher = dispatcher

    def run_once(self) -> bool:
        job = self.runtime.claim_job()
        if job is None:
            return False

        try:
            result = self.dispatcher.execute(job)
            self.runtime.complete(
                message_id=int(job["message_id"]),
                job_id=str(job["job_id"]),
                executor_version="scientific-worker-v1",
                result_object_path=str(result["result_object_path"]),
                result_sha256=str(result["result_sha256"]),
                result_bytes=int(result["result_bytes"]),
                result_summary=result.get("summary", {}),
                provenance=result.get("provenance", {}),
            )
        except Exception as exc:
            self.runtime.fail(
                message_id=int(job["message_id"]),
                job_id=str(job["job_id"]),
                failure_class="execution",
                processing_error=str(exc),
                retryable=True,
            )
            raise

        return True
