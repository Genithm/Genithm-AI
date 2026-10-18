"""Whole-object SHA-256 plus complete streamed FASTQ/gzip QC, not read sampling."""
from __future__ import annotations

import gzip
import hashlib
import io
import zlib
from time import monotonic
from .policy import CHUNK_BYTES, LargeDataError

MAX_READ_BYTES = 1024 * 1024
MAX_HEADER_BYTES = 4096
VALID_BASE = bytes(0 if chr(i) in "ACGTN" else 1 for i in range(256))
INVALID_QUAL = bytes(0 if 33 <= i <= 126 else 1 for i in range(256))
Q20 = bytes(1 if i >= 53 else 0 for i in range(256))
Q30 = bytes(1 if i >= 63 else 0 for i in range(256))


class HashingReader(io.RawIOBase):
    def __init__(self, source, expected_bytes, tick=lambda _n: None):
        self.source, self.expected_bytes, self.tick = source, expected_bytes, tick
        self.count = 0
        self.digest = hashlib.sha256()

    def readable(self):
        return True

    def readinto(self, buffer):
        if self.closed:
            raise ValueError("Stream closed")
        self.tick(self.count)
        maximum = min(len(buffer), CHUNK_BYTES, self.expected_bytes - self.count + 1)
        data = self.source.read(maximum)
        if not isinstance(data, bytes) or len(data) > maximum:
            raise LargeDataError("transfer_error")
        if not data:
            if self.count != self.expected_bytes:
                raise LargeDataError("transfer_error")
            return 0
        self.count += len(data)
        if self.count > self.expected_bytes:
            raise LargeDataError("source_changed")
        self.digest.update(data)
        buffer[:len(data)] = data
        return len(data)

    def close(self):
        if self.closed:
            return
        try:
            self.source.close()
        finally:
            super().close()


def scan_fastq(stream, max_expanded_bytes, tick=lambda: None):
    """Strict four-line FASTQ with whole-file aggregates and bounded profiles."""
    # Local import avoids a constants/scanner import cycle.
    from .fastq_scanner import FastqScanner
    scanner = FastqScanner(stream, max_expanded_bytes, tick)
    while scanner.next_header() is not None:
        pass
    return scanner.result()


def verify_stream(source, row, max_expanded_bytes, progress=lambda _n: None, cancelled=lambda: False,
                  max_seconds=3600):
    start = monotonic()
    last_report = start
    reader = None

    def tick(n):
        nonlocal last_report
        if cancelled():
            raise LargeDataError("lease_lost")
        now = monotonic()
        if now - start > max_seconds:
            raise LargeDataError("resource_limit")
        if now - last_report > 20:
            progress(n)
            last_report = now

    try:
        reader = HashingReader(source,row["expected_bytes"],tick)
        with io.BufferedReader(reader, buffer_size=CHUNK_BYTES) as raw:
            if row["data_format"] == "opaque":
                while raw.read(CHUNK_BYTES):
                    pass
                metrics = None
            elif row["data_format"] == "fastq":
                metrics = scan_fastq(raw,max_expanded_bytes,lambda:tick(reader.count))
            elif row["data_format"] == "fastq.gz":
                with gzip.GzipFile(fileobj=raw,mode="rb") as decoded:
                    metrics = scan_fastq(decoded,max_expanded_bytes,lambda:tick(reader.count))
            else:
                raise LargeDataError("format_invalid")
            # Drain all source bytes: gzip buffering and a final record without LF are accounted for.
            while raw.read(CHUNK_BYTES):
                pass
            if reader.count != row["expected_bytes"]:
                raise LargeDataError("transfer_error")
            digest = reader.digest.hexdigest()
            if digest != row["expected_sha256"]:
                raise LargeDataError("checksum_mismatch")
            progress(reader.count)
            result = {"schema":"genithm-large-data-result/1","source_bytes":reader.count,
                "format":row["data_format"],"verifier_version":"genithm-large-data/1.1.0",
                "verification":"whole_object_sha256","scientific_scope":"full_fastq_aggregate_qc" if metrics else "bytes_only",
                "metrics":metrics,"elapsed_seconds":round(monotonic()-start,3)}
            from .quality_report import seal_report
            result["source_sha256"] = digest
            return digest, seal_report(result)
    except (gzip.BadGzipFile, EOFError, zlib.error) as exc:
        raise LargeDataError("format_invalid") from exc
    finally:
        if reader is None:
            source.close()
        else:
            reader.close()
