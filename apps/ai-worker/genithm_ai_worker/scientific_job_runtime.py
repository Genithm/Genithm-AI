from __future__ import annotations

from typing import Any


class ScientificJobRuntime:
    """Runtime boundary for Genithm's existing scientific_jobs pipeline."""

    def __init__(self, rpc_client: Any):
        self.rpc_client = rpc_client

    def claim_job(self, visibility_seconds: int = 300) -> dict[str, Any] | None:
        response = self.rpc_client.rpc(
            "claim_scientific_job",
            {"visibility_seconds": visibility_seconds},
        )
        if response is None:
            return None
        if isinstance(response, list):
            return response[0] if response else None
        if not isinstance(response, dict):
            raise RuntimeError("invalid scientific job claim response")
        return response

    def complete(
        self,
        *,
        message_id: int,
        job_id: str,
        executor_version: str,
        result_object_path: str,
        result_sha256: str,
        result_bytes: int,
        result_summary: dict[str, Any],
        provenance: dict[str, Any],
    ) -> Any:
        return self.rpc_client.rpc(
            "finish_scientific_job_success",
            {
                "message_id": message_id,
                "job_id": job_id,
                "executor_version": executor_version,
                "result_object_path": result_object_path,
                "result_sha256": result_sha256,
                "result_bytes": result_bytes,
                "result_summary": result_summary,
                "provenance": provenance,
            },
        )

    def fail(
        self,
        *,
        message_id: int,
        job_id: str,
        failure_class: str,
        processing_error: str,
        retryable: bool,
        max_attempts: int = 3,
    ) -> Any:
        return self.rpc_client.rpc(
            "finish_scientific_job_error",
            {
                "message_id": message_id,
                "job_id": job_id,
                "failure_class": failure_class,
                "processing_error": processing_error,
                "retryable": retryable,
                "max_attempts": max_attempts,
            },
        )
