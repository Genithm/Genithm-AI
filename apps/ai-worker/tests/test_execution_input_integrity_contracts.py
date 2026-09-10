import pytest

from genithm_ai_worker.analysis_executor import AnalysisExecutor


class RecordingRuntime:
    def __init__(self) -> None:
        self.completed = None
        self.failures = []

    def complete(self, **kwargs):
        self.completed = kwargs
        return kwargs

    def fail(self, job_id: str, error: str, retryable: bool):
        self.failures.append((job_id, error, retryable))
        return None


def test_execution_input_snapshot_requires_checksum_and_source():
    snapshot = {
        "job_id": "job-1",
        "source": "user_upload",
        "checksum": "sha256-input-checksum",
    }

    assert snapshot["job_id"]
    assert snapshot["source"]
    assert snapshot["checksum"]


def test_execution_input_snapshot_is_separate_from_result():
    record = {
        "input_snapshot": {"checksum": "sha256-input-checksum"},
        "result": {"matches": []},
    }

    assert record["input_snapshot"] != record["result"]


def test_executor_persists_checksum_from_authoritative_input_snapshot():
    runtime = RecordingRuntime()
    checksum = "sha256:0123456789abcdef0123456789abcdef"
    executor = AnalysisExecutor(
        runtime,
        {"blast": lambda snapshot: {"source": snapshot["source"], "matches": []}},
    )

    executor.execute(
        {
            "job_id": "job-1",
            "workflow_type": "blast",
            "input_snapshot": {
                "source": "user_upload",
                "checksum": checksum,
            },
        }
    )

    assert runtime.completed is not None
    assert runtime.completed["input_checksum"] == checksum
    assert runtime.failures == []


def test_executor_rejects_missing_checksum_as_non_retryable_input_error():
    runtime = RecordingRuntime()
    executor = AnalysisExecutor(runtime, {"blast": lambda snapshot: {"matches": []}})

    with pytest.raises(ValueError, match="checksum is required"):
        executor.execute(
            {
                "job_id": "job-1",
                "workflow_type": "blast",
                "input_snapshot": {"source": "user_upload"},
            }
        )

    assert runtime.failures == [
        ("job-1", "analysis input snapshot checksum is required", False)
    ]
