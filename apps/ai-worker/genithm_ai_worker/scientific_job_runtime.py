from __future__ import annotations

from typing import Any


class ScientificJobRuntime:
    """Runtime boundary for Genithm's existing scientific_jobs pipeline.

    Keeps worker execution coupled to the existing scientific job model rather
    than introducing a parallel execution schema.
    """

    def __init__(self, rpc_client: Any, worker_id: str):
        if not worker_id:
            raise ValueError("worker_id is required")
        self.rpc_client = rpc_client
        self.worker_id = worker_id

    def claim_job(self) -> dict[str, Any] | None:
        response = self.rpc_client.rpc(
            "claim_scientific_job",
            {"worker_id": self.worker_id},
        )
        if response is None:
            return None
        if isinstance(response, list):
            return response[0] if response else None
        if not isinstance(response, dict):
            raise RuntimeError("invalid scientific job claim response")
        return response

    def update_status(self, job_id: str, status: str, metadata: dict[str, Any] | None = None) -> Any:
        return self.rpc_client.rpc(
            "update_scientific_job_status",
            {
                "job_id": job_id,
                "worker_id": self.worker_id,
                "status": status,
                "metadata": metadata or {},
            },
        )

    def complete(self, job_id: str, result: dict[str, Any], provenance: dict[str, Any]) -> Any:
        return self.rpc_client.rpc(
            "complete_scientific_job",
            {
                "job_id": job_id,
                "worker_id": self.worker_id,
                "result": result,
                "provenance": provenance,
            },
        )
