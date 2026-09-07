from __future__ import annotations

from dataclasses import dataclass, field

from genithm_sequence_worker.runtime import ValidationJob, process_one


JOB = ValidationJob(7, 1, "00000000-0000-0000-0000-000000000001", "org/project/user/upload/input.fasta", 10, "text/plain")


@dataclass
class FakeClient:
    data: bytes | None = b">x\nACGT\n"
    download_error: Exception | None = None
    claimed: bool = True
    max_attempts: int = 3
    calls: list[tuple] = field(default_factory=list)

    def claim(self):
        self.calls.append(("claim",))
        return JOB if self.claimed else None

    def download(self, job):
        self.calls.append(("download", job.upload_id))
        if self.download_error:
            raise self.download_error
        assert self.data is not None
        return self.data

    def finish_success(self, job, result, statistics):
        self.calls.append(
            (
                "success",
                result.sequence_type,
                result.sequence_count,
                result.residue_count,
                statistics.gc_content_percent,
                statistics.statistics_version,
            )
        )

    def finish_rejected(self, job, error, digest):
        self.calls.append(("rejected", error, digest))

    def finish_error(self, job, error):
        self.calls.append(("error", error))
        return "retry"


def test_no_job_returns_false() -> None:
    client = FakeClient(claimed=False)
    assert process_one(client) is False
    assert client.calls == [("claim",)]


def test_valid_fasta_finishes_successfully_with_statistics() -> None:
    client = FakeClient(data=b">x\nACGT\n")
    assert process_one(client) is True
    assert client.calls[-1] == (
        "success",
        "dna",
        1,
        4,
        50.0,
        "genithm-sequence-statistics/0.1.0",
    )


def test_invalid_fasta_is_scientific_rejection() -> None:
    client = FakeClient(data=b">x\nACGT1\n")
    assert process_one(client) is True
    assert client.calls[-1][0] == "rejected"
    assert len(client.calls[-1][2]) == 64


def test_download_failure_uses_retry_error_path() -> None:
    client = FakeClient(download_error=RuntimeError("storage unavailable"))
    assert process_one(client) is True
    assert client.calls[-1][0] == "error"
    assert "RuntimeError" in client.calls[-1][1]
