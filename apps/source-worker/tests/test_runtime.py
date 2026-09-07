from dataclasses import dataclass, field

from genithm_source_worker.ncbi import NcbiRecord, NcbiRecordNotFound
from genithm_source_worker.runtime import RetrievalJob, deterministic_upload_id, process_one

JOB = RetrievalJob(9, 1, "00000000-0000-0000-0000-000000000111", "00000000-0000-0000-0000-000000000001", "00000000-0000-0000-0000-000000000002", "00000000-0000-0000-0000-000000000003", "nucleotide", "NM_000001")
RECORD = NcbiRecord("nucleotide", "NM_000001", "NM_000001.2", "Example gene", "Homo sapiens", 4, "01-JAN-2026", "ACGT")


@dataclass
class FakeClient:
    claimed: bool = True
    max_attempts: int = 3
    calls: list[tuple] = field(default_factory=list)
    def claim(self): self.calls.append(("claim",)); return JOB if self.claimed else None
    def store(self, job, upload_id, record, fasta): self.calls.append(("store", upload_id, fasta))
    def finish_success(self, job, upload_id, record, fasta_size): self.calls.append(("success", upload_id, record.accession_version, fasta_size))
    def finish_not_found(self, job): self.calls.append(("not_found",))
    def finish_rejected(self, job, reason): self.calls.append(("rejected", reason))
    def finish_error(self, job, error): self.calls.append(("error", error)); return "retry"


class Connector:
    def __init__(self, error=None): self.error = error
    def fetch(self, database, accession):
        if self.error: raise self.error
        return RECORD


def test_no_job() -> None:
    client = FakeClient(claimed=False)
    assert process_one(client, Connector()) is False


def test_success_stores_then_finishes() -> None:
    client = FakeClient()
    assert process_one(client, Connector()) is True
    assert client.calls[-1][0] == "success"
    assert client.calls[-2][0] == "store"
    assert client.calls[-1][1] == deterministic_upload_id(JOB.retrieval_id)


def test_not_found_is_terminal_scientific_state() -> None:
    client = FakeClient()
    process_one(client, Connector(NcbiRecordNotFound("x")))
    assert client.calls[-1] == ("not_found",)


def test_transient_failure_uses_retry_path() -> None:
    client = FakeClient()
    process_one(client, Connector(RuntimeError("network")))
    assert client.calls[-1][0] == "error"
