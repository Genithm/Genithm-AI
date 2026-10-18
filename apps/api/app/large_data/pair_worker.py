"""Optional separate process for complete paired FASTQ validation, never a web task."""
from __future__ import annotations

import argparse
import logging
import os
import signal
import threading
from contextlib import ExitStack
from uuid import uuid4

from .policy import LargeDataError
from .routes import clients
from .paired import verify_pair

log = logging.getLogger("genithm.large-pair-worker")
ERROR_CODES = {"pair_count_mismatch", "pair_identifier_mismatch", "pair_orientation_mismatch",
    "pair_source_invalid", "source_changed", "checksum_mismatch", "format_invalid", "resource_limit", "transfer_error"}


def process_pair(c, worker_id, stop=None):
    stop = stop or threading.Event()
    if stop.is_set():
        return False
    job = c.rpc("pair_claim", p_worker=worker_id, p_storage=c.storage.config.identity)
    if not job:
        return False
    token = job["operation_token"]

    def progress(n, pairs):
        if not c.rpc("pair_progress", p_id=job["id"], p_token=token, p_bytes=n, p_pairs=pairs):
            raise LargeDataError("lease_lost")

    try:
        rows = job["sources"]
        infos = [c.storage.head(row) for row in rows]
        if len(rows) != 2 or any(info is None or info["etag"] != row["object_etag"] for row, info in zip(rows, infos)):
            raise LargeDataError("source_changed")
        with ExitStack() as stack:
            bodies = []
            for row in rows:
                body = c.storage.open(row)
                stack.callback(body.close)
                bodies.append(body)
            summary = verify_pair(bodies, rows, c.storage.config.max_expanded_bytes, progress, stop.is_set)
        if stop.is_set():
            return True
        if [c.storage.head(row) for row in rows] != infos:
            raise LargeDataError("source_changed")
        # Fenced SQL completion also rechecks the owner's project membership.
        c.rpc("pair_finish", p_id=job["id"], p_token=token, p_summary=summary, p_error=None)
    except LargeDataError as exc:
        if exc.code == "lease_lost":
            return True
        code = exc.code if exc.code in ERROR_CODES else "transfer_error"
        c.rpc("pair_finish", p_id=job["id"], p_token=token, p_summary=None, p_error=code)
    except Exception as exc:
        # Never log raw identifier bytes, storage URLs or database exception bodies.
        log.warning("paired verification failed: type=%s", type(exc).__name__)
        c.rpc("pair_finish", p_id=job["id"], p_token=token, p_summary=None, p_error="transfer_error")
    return True


def main():
    parser = argparse.ArgumentParser(description="Genithm managed paired-read verifier")
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()
    if os.getenv("GENITHM_LARGE_DATA_PAIRING_ENABLED", "").lower() != "true":
        parser.error("Paired validation is disabled; explicit operator activation required")
    c, worker, stop = clients(), str(uuid4()), threading.Event()
    logging.basicConfig(level=logging.INFO)
    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, lambda *_: stop.set())

    def pulse():
        while not stop.is_set():
            try:
                c.rpc("pair_heartbeat", p_worker=worker, p_storage=c.storage.config.identity)
            except Exception:
                log.warning("paired verifier heartbeat unavailable")
            stop.wait(30)

    heart = threading.Thread(target=pulse, daemon=True)
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
