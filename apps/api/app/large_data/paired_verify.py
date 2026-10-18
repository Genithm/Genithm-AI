"""Bounded complete R1/R2 correspondence check; no read sampling or retained names."""
from __future__ import annotations

from contextlib import ExitStack
import gzip
import hashlib
import io
import json
import re
from time import monotonic
import zlib

from .policy import CHUNK_BYTES, LargeDataError
from .verify import HashingReader, MAX_HEADER_BYTES, MAX_READ_BYTES, VALID_BASE, INVALID_QUAL, Q20, Q30

VERSION = "genithm-large-data-pair/1.0.0"
SCHEMA = "genithm-paired-fastq-result/1"
CASAVA = re.compile(rb"([12]):[YN]:[0-9]+:[!-~]+\Z")


def identity(header: bytes) -> tuple[bytes, int | None]:
    """Only the first token is the read key. Never return it outside this process."""
    if not header.startswith(b"@") or len(header) < 2 or header[1] == 32:
        raise LargeDataError("format_invalid")
    if any(c < 32 or c > 126 for c in header):
        raise LargeDataError("format_invalid")
    tokens = header[1:].split()
    key, mate = tokens[0], None
    if key.endswith((b"/1", b"/2")):
        key, mate = key[:-2], int(key[-1:])
    if not key:
        raise LargeDataError("format_invalid")
    if len(tokens) > 1 and re.match(rb"[0-9]+:", tokens[1]):
        match = CASAVA.fullmatch(tokens[1])
        if not match:
            raise LargeDataError("format_invalid")
        annotation = int(match[1])
        if mate is not None and mate != annotation:
            raise LargeDataError("mate_orientation_mismatch")
        mate = annotation
    return key, mate


class FastqRecords:
    """At most one bounded record per stream is resident. Statistics are exhaustive."""
    def __init__(self, stream, max_expanded_bytes):
        self.stream, self.maximum = stream, max_expanded_bytes
        self.expanded = self.records = self.bases = self.quality_sum = self.q20 = self.q30 = 0
        self.counts = {base: 0 for base in "ACGTN"}
        self.minimum, self.longest = MAX_READ_BYTES + 1, 0

    def line(self, limit):
        raw = self.stream.readline(limit + 2)
        self.expanded += len(raw)
        if self.expanded > self.maximum:
            raise LargeDataError("resource_limit")
        value = raw.removesuffix(b"\n").removesuffix(b"\r")
        if len(value) > limit:
            raise LargeDataError("resource_limit")
        return value, bool(raw)

    def next_identity(self):
        header, exists = self.line(MAX_HEADER_BYTES)
        if not exists:
            return None
        key, mate = identity(header)
        seq, a = self.line(MAX_READ_BYTES)
        plus, b = self.line(MAX_HEADER_BYTES)
        quality, c = self.line(MAX_READ_BYTES)
        if (not (a and b and c) or not seq or len(seq) != len(quality) or
                not plus.startswith(b"+") or (len(plus) > 1 and plus[1:] != header[1:])):
            raise LargeDataError("format_invalid")
        seq = seq.upper()
        if seq.translate(VALID_BASE).count(b"\x01") or quality.translate(INVALID_QUAL).count(b"\x01"):
            raise LargeDataError("format_invalid")
        self.records += 1
        self.bases += len(seq)
        self.minimum, self.longest = min(self.minimum, len(seq)), max(self.longest, len(seq))
        for base in self.counts:
            self.counts[base] += seq.count(base.encode())
        self.quality_sum += sum(quality) - 33 * len(quality)
        self.q20 += quality.translate(Q20).count(b"\x01")
        self.q30 += quality.translate(Q30).count(b"\x01")
        return key, mate

    def summary(self):
        if not self.records:
            raise LargeDataError("format_invalid")
        known = self.bases - self.counts["N"]
        return {"read_count": self.records, "base_count": self.bases, "base_counts": self.counts,
                "mean_phred": self.quality_sum / self.bases, "q20_bases": self.q20, "q30_bases": self.q30,
                "gc_percent": 100 * (self.counts["G"] + self.counts["C"]) / known if known else None,
                "min_length": self.minimum, "max_length": self.longest, "mean_length": self.bases / self.records,
                "expanded_bytes": self.expanded, "quality_encoding": "phred33_assumed"}


def canonical_result(result) -> bytes:
    return json.dumps(result, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False).encode()


def result_digest(result) -> str:
    return hashlib.sha256(canonical_result(result)).hexdigest()


def verify_pair(sources, rows, max_expanded_bytes, progress=lambda _a, _b: None,
                cancelled=lambda: False, max_seconds=3600):
    """Recheck both whole objects and every ordered read pair. Close both on every exit."""
    started = last_report = monotonic()
    readers = []

    def tick(_n=0, force=False):
        nonlocal last_report
        if cancelled():
            raise LargeDataError("lease_lost")
        now = monotonic()
        if now - started > max_seconds:
            raise LargeDataError("resource_limit")
        if len(readers) == 2 and (force or now - last_report >= 20):
            progress(readers[0].count, readers[1].count)
            last_report = now

    with ExitStack() as stack:
        # Register ownership BEFORE validating metadata; no error may leak a stream.
        for source in sources:
            stack.callback(source.close)
        if len(sources) != 2 or len(rows) != 2:
            raise LargeDataError("format_invalid")
        scanners, raws = [], []
        try:
            for source, row in zip(sources, rows):
                if row["data_format"] not in {"fastq", "fastq.gz"}:
                    raise LargeDataError("format_invalid")
                reader = HashingReader(source, row["expected_bytes"], tick)
                readers.append(reader)
                raw = stack.enter_context(io.BufferedReader(reader, buffer_size=CHUNK_BYTES))
                raws.append(raw)
                stream = stack.enter_context(gzip.GzipFile(fileobj=raw, mode="rb")) if row["data_format"] == "fastq.gz" else raw
                scanners.append(FastqRecords(stream, max_expanded_bytes))
            matched = annotated = order_only = 0
            while True:
                tick()
                a, b = (scanner.next_identity() for scanner in scanners)
                if a is None and b is None:
                    break
                if a is None or b is None:
                    raise LargeDataError("pair_count_mismatch")
                if a[0] != b[0]:
                    raise LargeDataError("pair_identifier_mismatch")
                if a[1] == 2 or b[1] == 1:
                    raise LargeDataError("mate_orientation_mismatch")
                matched += 1
                if a[1] == 1 and b[1] == 2:
                    annotated += 1
                else:
                    order_only += 1
            metrics = [scanner.summary() for scanner in scanners]
            for raw in raws:
                while raw.read(CHUNK_BYTES):
                    tick()
            for reader, row in zip(readers, rows):
                if reader.count != row["expected_bytes"]:
                    raise LargeDataError("transfer_error")
                if reader.digest.hexdigest() != row["expected_sha256"]:
                    raise LargeDataError("checksum_mismatch")
            tick(force=True)
            result = {"schema": SCHEMA, "verifier_version": VERSION, "verification": "whole_object_sha256_both",
                      "scientific_scope": "complete_ordered_paired_fastq_qc", "sampling": False,
                      "matched_pairs": matched, "both_mate_annotations_checked": annotated,
                      "identifier_order_only_pairs": order_only, "identifier_uniqueness_checked": False,
                      "identical_source_bytes": rows[0]["expected_sha256"] == rows[1]["expected_sha256"],
                      "r1": {"upload_id": rows[0]["id"], "sha256": readers[0].digest.hexdigest(),
                             "source_bytes": readers[0].count, "format": rows[0]["data_format"], "metrics": metrics[0]},
                      "r2": {"upload_id": rows[1]["id"], "sha256": readers[1].digest.hexdigest(),
                             "source_bytes": readers[1].count, "format": rows[1]["data_format"], "metrics": metrics[1]}}
            return result, result_digest(result)
        except (gzip.BadGzipFile, EOFError, zlib.error) as exc:
            raise LargeDataError("format_invalid") from exc
