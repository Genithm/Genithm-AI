from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Callable

from .analysis_runtime import AnalysisRuntime


class AnalysisExecutor:
    """Coordinates scientific execution with persistence.

    Tool implementations remain injected. This keeps execution deterministic
    and prevents the persistence layer from knowing scientific tool details.
    """

    def __init__(self, runtime: AnalysisRuntime, tools: dict[str, Callable[[dict[str, Any]], dict[str, Any]]]):
        self.runtime = runtime
        self.tools = tools

    def execute(self, job: dict[str, Any]) -> Any:
        workflow_type = str(job.get("workflow_type", ""))
        tool = self.tools.get(workflow_type)
        if tool is None:
            self.runtime.fail(str(job["job_id"]), "unsupported workflow type", False)
            raise ValueError("unsupported workflow type")

        try:
            output = tool(job["input_snapshot"])
            return self.runtime.complete(
                job_id=str(job["job_id"]),
                result_payload=output,
                tool_name=workflow_type,
                tool_version="v1",
                parameters={},
                input_checksum=str(job.get("input_checksum", "unknown")),
                executed_at=datetime.now(timezone.utc).isoformat(),
                evidence_snapshot={
                    "schema_version": "ai-evidence-v1",
                    "facts": [
                        {
                            "id": "execution-result",
                            "label": "workflow_output",
                            "value": output,
                        }
                    ],
                },
            )
        except Exception as exc:
            self.runtime.fail(str(job["job_id"]), str(exc), True)
            raise
