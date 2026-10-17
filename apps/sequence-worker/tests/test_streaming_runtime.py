from __future__ import annotations

import io
from dataclasses import replace
from hashlib import sha256
from threading import Thread
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from genithm_sequence_worker.runtime import RuntimeConfig, SupabaseRuntimeClient, ValidationJob, process_one
from genithm_sequence_worker.streaming import CHUNK_BYTES, FastaTransferError, FastaStreamValidationError
from genithm_sequence_worker.validator import MAX_FILE_BYTES

DATA = b">one\nACGTNN\n>two\nGC\n"
JOB = ValidationJob(7, 1, "id", "org/project/user/id/input.fasta", len(DATA), "text/plain")


class BoundedBody(io.BytesIO):
    def read(self, n=-1):
        assert 0 < n <= CHUNK_BYTES, "The production path requested an unbounded read"
        return super().read(n)


def test_supabase_network_stream_uses_existing_scope_and_completion(monkeypatch):
    calls = []
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass
        def do_GET(self):
            calls.append((self.path, self.headers.get("apikey")))
            self.send_response(200)
            self.send_header("Content-Length", str(len(DATA)))
            self.end_headers()
            for i in range(0, len(DATA), 3):
                self.wfile.write(DATA[i:i+3])
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        client = SupabaseRuntimeClient(RuntimeConfig(f"http://127.0.0.1:{server.server_port}", "synthetic-test-key"))
        finished = []
        monkeypatch.setattr(client, "claim", lambda: JOB)
        monkeypatch.setattr(client, "download", lambda _job: (_ for _ in ()).throw(AssertionError("No whole download")))
        monkeypatch.setattr(client, "_rpc", lambda name, payload: finished.append((name, payload)))
        assert process_one(client)
        assert calls == [("/storage/v1/object/authenticated/sequence-inputs/org/project/user/id/input.fasta", "synthetic-test-key")]
        assert len(finished) == 1
        name, result = finished[0]
        assert name == "finish_sequence_validation_success_v2"
        assert result["upload_id"] == JOB.upload_id
        assert result["sha256"] == sha256(DATA).hexdigest()
        assert result["residue_count"] == 8
        assert result["statistics"]["gc_content_percent"] == 66.666667
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=3)


@pytest.mark.parametrize("data, error", [(DATA, None), (b"x" * len(DATA), FastaStreamValidationError), (b"short", FastaTransferError), (DATA + b"long", FastaTransferError)])
def test_r2_chunk_bound_and_stream_closure_on_every_outcome(monkeypatch, data, error):
    body = BoundedBody(data)
    class R2:
        def get_object(self, **kwargs):
            assert kwargs == {"Bucket": "private-sequences", "Key": JOB.object_path}
            return {"Body": body}
    config = RuntimeConfig("https://example.invalid", "test-key", r2_sequence_bucket="private-sequences")
    client = SupabaseRuntimeClient(config)
    monkeypatch.setattr(client, "_r2_client", lambda: R2())
    if error:
        with pytest.raises(error):
            client.inspect_input(replace(JOB, storage_provider="r2"))
    else:
        v, stats = client.inspect_input(replace(JOB, storage_provider="r2"))
        assert v.sha256 == sha256(DATA).hexdigest()
        assert stats.sequence_count == 2
    assert body.closed


def test_oversized_metadata_is_rejected_before_network_request(monkeypatch):
    client = SupabaseRuntimeClient(RuntimeConfig("https://example.invalid", "test"))
    monkeypatch.setattr("genithm_sequence_worker.runtime.urlopen", lambda *_a, **_k: pytest.fail("Must not open a connection"))
    with pytest.raises(FastaTransferError):
        client.inspect_input(replace(JOB, file_size_bytes=MAX_FILE_BYTES + 1))


def test_failed_transfer_never_finishes_scientific_success_or_prefix_rejection(monkeypatch):
    client = SupabaseRuntimeClient(RuntimeConfig("https://example.invalid", "test"))
    monkeypatch.setattr(client, "claim", lambda: JOB)
    def failed(_job):
        raise FastaTransferError("Downloaded sequence does not match its declared size")
    monkeypatch.setattr(client, "inspect_input", failed)
    calls = []
    monkeypatch.setattr(client, "_rpc", lambda name, payload: calls.append((name, payload)) or "retry")
    assert process_one(client)
    assert len(calls) == 1
    assert calls[0][0] == "finish_sequence_validation_error"


def test_full_scientific_rejection_keeps_complete_raw_digest(monkeypatch):
    from genithm_sequence_worker.streaming import analyze_fasta_chunks
    malformed = b">a\nBAD1\nAAAA\n"
    client = SupabaseRuntimeClient(RuntimeConfig("https://example.invalid", "test"))
    monkeypatch.setattr(client, "claim", lambda: replace(JOB, file_size_bytes=len(malformed)))
    monkeypatch.setattr(client, "inspect_input", lambda _job: analyze_fasta_chunks([malformed[:8], malformed[8:]], expected_size=len(malformed)))
    calls = []
    monkeypatch.setattr(client, "_rpc", lambda name, payload: calls.append((name, payload)))
    assert process_one(client)
    assert calls[0][0] == "finish_sequence_validation_rejected"
    assert calls[0][1]["sha256"] == sha256(malformed).hexdigest()
