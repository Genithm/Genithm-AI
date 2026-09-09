from __future__ import annotations

from typing import Any


class AnalysisRuntime:
    """Persistence boundary for scientific analysis execution.

    Keeps scientific execution code independent from storage transport. The
    caller supplies an RPC client compatible with the Supabase RPC boundary.
    """

    def __init__(self, rpc_client: Any, worker_id: str) -> None:
        if not worker_id:
            raise ValueError("worker_id is required")
        self.rpc_client = rpc_client
        self.worker_id = worker_id

    def claim(self, lease_seconds: int = 300) -> dict[str, Any] | None:
        response = self.rpc_client.rpc(
            "claim_analysis_job",
            {"worker_id": self.worker_id, "lease_seconds": lease_seconds},
        )
        if response is None:
            return None
        if isinstance(response, list):
            return response[0] if response else None
        if not isinstance(response, dict):
            raise RuntimeError("analysis claim response shape is invalid")
        return response

    def complete(
        self,
        *,
        job_id: str,
        result_payload: dict[str, Any],
        tool_name: str,
        tool_version: str,
        parameters: dict[str, Any],
        input_checksum: str,
        executed_at: str,
        evidence_snapshot: dict[str, Any],
    ) -> Any:
        return self.rpc_client.rpc(
            "finish_analysis_job_success",
            {
                "job_id": job_id,
                "worker_id": self.worker_id,
                "result_payload": result_payload,
                "tool_name": tool_name,
                "tool_version": tool_version,
                "parameters": parameters,
                "input_checksum": input_checksum,
                "executed_at": executed_at,
                "evidence_snapshot": evidence_snapshot,
            },
        )

    def fail(self, job_id: str, error: str, retryable: bool) -> Any:
        return self.rpc_client.rpc(
            "finish_analysis_job_error",
            {
                "job_id": job_id,
                "worker_id": self.worker_id,
                "processing_error": error,
                "retryable": retryable,
            },
        )
