"""Optional durable paired FASTQ worker. One dataset at a time; no web-request execution."""
from __future__ import annotations

import argparse
from contextlib import ExitStack
import logging
import os
import signal
import threading
from uuid import uuid4

from .routes import clients
from .policy import LargeDataError
from .paired_verify import verify_pair

log = logging.getLogger("genithm.large-data-pair")
ERRORS = {"pair_count_mismatch", "pair_identifier_mismatch", "mate_orientation_mismatch", "format_invalid",
          "checksum_mismatch", "resource_limit", "source_changed", "transfer_error"}


def process_pair(c, worker_id, stop=None):
    stop = stop or threading.Event()
    claim = c.rpc("pair_claim", p_worker=worker_id, p_storage=c.storage.config.identity)
    if not claim:
        return False
    job, rows = claim["job"], [claim["r1"], claim["r2"]]
    token = job["operation_token"]
    result = digest = error = None

    def progress(a, b):
        if not c.rpc("pair_progress", p_id=job["id"], p_token=token, p_read1_bytes=a, p_read2_bytes=b):
            raise LargeDataError("lease_lost")

    try:
        for i, row in enumerate(rows, 1):
            if (row["id"] != job[f"read{i}_id"] or row["expected_sha256"] != job[f"read{i}_sha256"] or
                    row["object_etag"] != job[f"read{i}_etag"] or row["expected_bytes"] != job[f"read{i}_bytes"]):
                raise LargeDataError("source_changed")
        before = [c.storage.head(row) for row in rows]
        if any(info is None or info["etag"] != row["object_etag"] for info, row in zip(before, rows)):
            raise LargeDataError("source_changed")
        # If opening R2 fails, R1 must still be closed. verify_pair also owns all readers.
        with ExitStack() as stack:
            sources = []
            for row in rows:
                source = c.storage.open(row)
                stack.callback(source.close)
                sources.append(source)
            result, digest = verify_pair(sources, rows, c.storage.config.max_expanded_bytes, progress, stop.is_set)
        if [c.storage.head(row) for row in rows] != before:
            raise LargeDataError("source_changed")
    except LargeDataError as exc:
        if exc.code == "lease_lost":
            return True  # Cancellation, permission loss or an expired token cannot publish.
        error = exc.code if exc.code in ERRORS else "transfer_error"
    except Exception as exc:
        log.warning("paired verification failed: type=%s", type(exc).__name__)
        error = "transfer_error"
    # A commit whose reply is lost is NOT repeated as a failure or a successful retry.
    # The durable state/lease establishes whether a later process can acquire this job.
    c.rpc("pair_finish", p_id=job["id"], p_token=token, p_result=None if error else result,
          p_sha256=None if error else digest, p_error=error)
    return True


def main():
    parser = argparse.ArgumentParser(description="Genithm full-object paired-end FASTQ QC worker")
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()
    if os.getenv("GENITHM_LARGE_DATA_PAIRS_ENABLED", "").lower() != "true":
        parser.error("Set GENITHM_LARGE_DATA_PAIRS_ENABLED=true only after migration and resource review")
    c, worker, stop = clients(), str(uuid4()), threading.Event()
    logging.basicConfig(level=logging.INFO)
    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, lambda *_: stop.set())

    def heartbeat():
        while not stop.is_set():
            try:
                c.rpc("pair_heartbeat", p_worker=worker, p_storage=c.storage.config.identity)
            except Exception:
                log.warning("paired worker heartbeat unavailable")
            stop.wait(30)

    heart = threading.Thread(target=heartbeat, daemon=True)
    heart.start()
    try:
        while not stop.is_set():
            try:
                worked = process_pair(c, worker, stop)
            except Exception as exc:
                log.warning("paired worker cycle failed: type=%s", type(exc).__name__)
                worked = False
            if args.once:
                break
            if not worked:
                stop.wait(3)
    finally:
        stop.set()
        heart.join(timeout=2)


if __name__ == "__main__":
    main()
