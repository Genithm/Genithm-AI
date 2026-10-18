"""Dedicated opt-in verifier process. No heavyweight work executes in web requests."""
from __future__ import annotations

import argparse
import logging
import signal
import threading
from uuid import uuid4

from .routes import clients
from .policy import LargeDataError
from .verify import verify_stream

log = logging.getLogger("genithm.large-data-verifier")


def process_one(c, worker_id, stop=None, *, universal=False):
    stop = stop or threading.Event()
    row = c.rpc("claim_file_v47" if universal else "claim",p_worker=worker_id,p_storage=c.storage.config.identity)
    if not row:
        return False
    token = row["operation_token"]
    def progress(n):
        if not c.rpc("progress",p_id=row["id"],p_token=token,p_bytes=n):
            raise LargeDataError("lease_lost")
    try:
        info = c.storage.head(row)
        if info is None or info["etag"] != row["object_etag"]:
            raise LargeDataError("source_changed")
        digest,summary = verify_stream(c.storage.open(row),row,c.storage.config.max_expanded_bytes,
                                       progress,stop.is_set)
        # Prevent an object replacement between initial HEAD and result publication.
        final = c.storage.head(row)
        if final != info:
            raise LargeDataError("source_changed")
        c.rpc("finish_verification",p_id=row["id"],p_token=token,p_sha256=digest,p_summary=summary,p_error=None)
    except LargeDataError as exc:
        if exc.code == "lease_lost":
            return True  # Expired/stopped attempts may never publish a result.
        code = exc.code if exc.code in {"source_changed","resource_limit","checksum_mismatch","format_invalid","transfer_error"} else "transfer_error"
        c.rpc("finish_verification",p_id=row["id"],p_token=token,p_sha256=None,p_summary=None,p_error=code)
    except Exception as exc:
        log.warning("large-data verification failed: type=%s",type(exc).__name__)
        c.rpc("finish_verification",p_id=row["id"],p_token=token,p_sha256=None,p_summary=None,p_error="transfer_error")
    return True


def main():
    parser = argparse.ArgumentParser(description="Genithm private file integrity, FASTQ and FASTA verifier")
    parser.add_argument("--once",action="store_true")
    args = parser.parse_args()
    c, worker_id, stop = clients(), str(uuid4()), threading.Event()
    logging.basicConfig(level=logging.INFO)
    for sig in (signal.SIGTERM,signal.SIGINT):
        signal.signal(sig,lambda *_: stop.set())
    def pulse():
        while not stop.is_set():
            try:
                c.rpc("heartbeat_file_v47",p_worker=worker_id,p_storage=c.storage.config.identity)
            except Exception:
                log.warning("large-data heartbeat unavailable")
            stop.wait(30)
    # Register capability synchronously so --once cannot race its first claim.
    c.rpc("heartbeat_file_v47",p_worker=worker_id,p_storage=c.storage.config.identity)
    heart = threading.Thread(target=pulse,daemon=True)
    heart.start()
    try:
        while not stop.is_set():
            try:
                worked = process_one(c,worker_id,stop,universal=True)
            except Exception as exc:
                log.warning("large-data worker cycle failed: type=%s",type(exc).__name__)
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
