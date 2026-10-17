from __future__ import annotations

import argparse
import hashlib
import json
import multiprocessing
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from types import SimpleNamespace

import pytest

from genithm_scientific_worker.consumer_pool import (
    _science_consumer, concurrency_value, consume_until_stopped, supervise_consumers,
)
from genithm_scientific_worker.runtime import Config


def _crash(_stop):
    raise SystemExit(7)


@pytest.mark.parametrize("value", ["0", "5", "-1", "100", "1.5", "nan", ""])
def test_capacity_is_explicitly_bounded(value):
    with pytest.raises(argparse.ArgumentTypeError):
        concurrency_value(value)


def test_approved_capacity_values():
    assert [concurrency_value(str(n)) for n in range(1, 5)] == [1, 2, 3, 4]


def test_shutdown_never_claims_an_extra_job():
    stop = threading.Event()
    client = SimpleNamespace(config=SimpleNamespace(poll_seconds=0.01))
    calls = []
    def work(arg):
        calls.append(arg)
        stop.set()
        return True
    consume_until_stopped(client, work, stop)
    assert calls == [client]


def test_ambiguous_rpc_errors_are_not_replayed():
    stop = threading.Event()
    calls = []
    def work(_client):
        calls.append(1)
        raise RuntimeError("connection failed after an unknown commit outcome")
    with pytest.raises(RuntimeError):
        consume_until_stopped(None, work, stop)
    assert calls == [1]


def test_supervisor_fails_visibly_on_unexpected_child_exit():
    assert supervise_consumers(_crash, (), concurrency=1, grace_seconds=1) == 1


def test_two_real_consumers_claim_download_align_audit_and_publish_distinct_jobs():
    """Real worker code against loopback-only RPC/storage fixtures, not live RLS.

    Downloads wait until both claims arrive, so a sequential worker cannot pass.
    No test changes the application executor or disables its integrity checks.
    """
    context = multiprocessing.get_context("spawn")
    stop = context.Event()
    both_claimed = threading.Event()
    lock = threading.Lock()
    fasta = {"a.fa": b">a\nGATTACA\n", "b.fa": b">b\nGCATGCA\n"}
    org, project = "10000000-0000-4000-8000-000000000001", "20000000-0000-4000-8000-000000000001"
    inputs = [{"position": i, "role": role, "object_path": path, "file_size_bytes": len(fasta[path]),
               "sha256": hashlib.sha256(fasta[path]).hexdigest(), "sequence_type": "dna", "residue_count": 7}
              for i, (path, role) in enumerate([("a.fa", "sequence_a"), ("b.fa", "sequence_b")], 1)]
    jobs = [{"message_id": i, "job_id": f"30000000-0000-4000-8000-{i:012d}",
             "organization_id": org, "project_id": project, "job_type": "pairwise_alignment",
             "tool_id": "genithm-pairwise-aligner", "tool_version": "0.1.0",
             "parameters": {"algorithm": "global", "match_score": 2, "mismatch_score": -1, "gap_score": -2},
             "request_fingerprint": str(i) * 64, "inputs": inputs} for i in (1, 2)]
    pending = list(jobs)
    claimed, completed, failures, uploaded = [], [], [], {}

    class Gateway(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass
        def reply(self, value, code=200):
            body = json.dumps(value).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(body)
        def do_GET(self):
            if not both_claimed.wait(8):
                self.reply({"error": "parallel claims did not arrive"}, 500)
                return
            raw = fasta.get(self.path.rsplit("/", 1)[-1])
            if raw is None:
                self.reply({}, 404)
                return
            self.send_response(200)
            self.end_headers()
            self.wfile.write(raw)
        def do_POST(self):
            raw = self.rfile.read(int(self.headers.get("Content-Length", "0")))
            if self.headers.get("apikey") != "fixture-secret-not-a-real-key":
                self.reply({}, 401)
                return
            if self.path == "/rest/v1/rpc/claim_scientific_job":
                with lock:
                    job = pending.pop(0) if pending else None
                    if job:
                        claimed.append(job["job_id"])
                    if len(claimed) == 2:
                        both_claimed.set()
                self.reply([job] if job else [])
            elif self.path.startswith("/storage/v1/object/analysis-results/"):
                with lock:
                    uploaded[self.path.split("/analysis-results/", 1)[1]] = raw
                self.reply({})
            elif self.path == "/rest/v1/rpc/finish_scientific_job_success":
                args = json.loads(raw)
                with lock:
                    data = uploaded.get(args["result_object_path"], b"")
                    valid = hashlib.sha256(data).hexdigest() == args["result_sha256"] and len(data) == args["result_bytes"]
                    if valid:
                        completed.append(args["job_id"])
                    else:
                        failures.append("artifact did not match commit")
                    if len(completed) == 2 or failures:
                        stop.set()
                self.reply(None)
            else:
                with lock:
                    failures.append(self.path)
                stop.set()
                self.reply(None)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Gateway)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    deadline = threading.Timer(20, stop.set)
    deadline.start()
    try:
        config = Config(f"http://127.0.0.1:{server.server_port}", "fixture-secret-not-a-real-key", poll_seconds=0.05)
        status = supervise_consumers(_science_consumer, (config,), concurrency=2, grace_seconds=2, stop_event=stop)
        assert status == 0
        assert both_claimed.is_set()
        assert sorted(claimed) == sorted(job["job_id"] for job in jobs)
        assert sorted(completed) == sorted(claimed)
        assert len(uploaded) == 2
        assert failures == []
        for data in uploaded.values():
            artifact = json.loads(data)
            assert artifact["schema_version"] == "genithm-pairwise-result/1"
            assert artifact["summary"]["input_a_sha256"] == inputs[0]["sha256"]
    finally:
        deadline.cancel()
        server.shutdown()
        server.server_close()
        thread.join(2)
