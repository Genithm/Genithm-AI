from __future__ import annotations

from typing import Any, Callable

from .workflows import sequence_summary


WorkflowHandler = Callable[[dict[str, Any]], dict[str, Any]]


SCIENTIFIC_WORKFLOW_HANDLERS: dict[str, WorkflowHandler] = {
    "sequence_summary": sequence_summary,
}


def get_workflow_handler(job_type: str) -> WorkflowHandler:
    handler = SCIENTIFIC_WORKFLOW_HANDLERS.get(job_type)
    if handler is None:
        raise ValueError(f"unsupported scientific workflow: {job_type}")
    return handler
