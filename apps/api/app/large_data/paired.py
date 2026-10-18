"""Complete ordered FASTQ mate comparison; constant-memory, no identifier output."""
from __future__ import annotations

import gzip
import io
import re
import zlib
from contextlib import ExitStack
from time import monotonic

from .policy import CHUNK_BYTES, LargeDataError
from .verify import HashingReader, MAX_HEADER_BYTES
from .fastq_scanner import FastqScanner

PAIR_VERSION = "genithm-large-pair/1.0.0"
PAIR_SCHEMA = "genithm-large-pair-result/1"
# Match documented CASAVA read/filter/control/index fields, not arbitrary comments.
CASAVA = re.compile(rb"([12]):[YN]:[0-9]+:[^\s]*")


def mate_identifier(header: bytes):
    """Return identifier and optional mate label; never guess SRA .1/.2 suffixes."""
    if (not isinstance(header, bytes) or not 2 <= len(header) <= MAX_HEADER_BYTES or
        not header.startswith(b"@") or header[1:2] == b" " or
        any(c < 32 or c == 127 for c in header)):
        raise LargeDataError("format_invalid")
    fields = header[1:].split(b" ")
    key, mate = fields[0], None
    if key.endswith((b"/1", b"/2")):
        mate = key[-1] - 48
        key = key[:-2]
    if not key:
        raise LargeDataError("format_invalid")
    # Multiple spaces are accepted between identifier and description.
    rest = next((x for x in fields[1:] if x), b"")
    parsed = CASAVA.fullmatch(rest)
    if parsed:
        second = int(parsed.group(1))
        if mate is not None and mate != second:
            raise LargeDataError("pair_orientation_mismatch")
        mate = second
    elif rest.startswith((b"1:", b"2:")):
        # Looks like a mate descriptor but is malformed: do not silently ignore.
        raise LargeDataError("format_invalid")
    return key, mate


def verify_pair(sources, rows, max_expanded_bytes, progress=lambda _n, _pairs: None,
                cancelled=lambda: False, max_seconds=7200):
    """Read both immutable source objects fully, compare every ordered identifier.

    max_expanded_bytes applies to EACH source. Pair labels check R1/R2 roles,
    not molecular strand orientation, read alignment, or biological pairing.
    All handles close, including on partial setup, parser failure or cancellation.
    """
    readers = []
    pairs = oriented = partial = unmarked = 0
    started = last_report = monotonic()

    def tick(_n=0):
        nonlocal last_report
        if cancelled():
            raise LargeDataError("lease_lost")
        now = monotonic()
        if now - started > max_seconds:
            raise LargeDataError("resource_limit")
        if now - last_report >= 20:
            progress(sum(r.count for r in readers), pairs)
            last_report = now

    with ExitStack() as stack:
        # Register both bodies before validation to avoid leaks on invalid metadata.
        for source in sources:
            stack.callback(source.close)
        if len(sources) != 2 or len(rows) != 2 or rows[0]["id"] == rows[1]["id"]:
            raise LargeDataError("pair_source_invalid")
        try:
            scanners, raw_streams = [], []
            for source, row in zip(sources, rows):
                if row["data_format"] not in {"fastq", "fastq.gz"}:
                    raise LargeDataError("pair_source_invalid")
                reader = HashingReader(source, row["expected_bytes"], tick)
                readers.append(reader)
                raw = stack.enter_context(io.BufferedReader(reader, buffer_size=CHUNK_BYTES))
                raw_streams.append(raw)
                decoded = stack.enter_context(gzip.GzipFile(fileobj=raw, mode="rb")) if row["data_format"] == "fastq.gz" else raw
                scanners.append(FastqScanner(decoded, max_expanded_bytes, tick))
            while True:
                h1, h2 = scanners[0].next_header(), scanners[1].next_header()
                if h1 is None and h2 is None:
                    break
                if h1 is None or h2 is None:
                    raise LargeDataError("pair_count_mismatch")
                k1, m1 = mate_identifier(h1)
                k2, m2 = mate_identifier(h2)
                if k1 != k2:
                    raise LargeDataError("pair_identifier_mismatch")
                if m1 == 2 or m2 == 1:
                    raise LargeDataError("pair_orientation_mismatch")
                pairs += 1
                if m1 == 1 and m2 == 2:
                    oriented += 1
                elif m1 is not None or m2 is not None:
                    partial += 1
                else:
                    unmarked += 1
            metrics = [s.result() for s in scanners]  # Empty FASTQ is invalid.
            digests = []
            for reader, raw, row in zip(readers, raw_streams, rows):
                while raw.read(CHUNK_BYTES):
                    pass
                if reader.count != row["expected_bytes"]:
                    raise LargeDataError("transfer_error")
                digest = reader.digest.hexdigest()
                if digest != row["expected_sha256"]:
                    raise LargeDataError("checksum_mismatch")
                digests.append(digest)
            tick()
            progress(sum(r.count for r in readers), pairs)
            for metric in metrics:
                metric["paired_identifiers_checked"] = True
            return {"schema": PAIR_SCHEMA, "verifier_version": PAIR_VERSION,
                "verification": "both_whole_object_sha256", "scientific_scope": "ordered_paired_fastq_qc",
                "source_ids": [row["id"] for row in rows], "source_sha256": digests,
                "source_bytes": [r.count for r in readers], "pair_count": pairs,
                "explicit_mate_labels": oriented, "partially_labeled_pairs": partial,
                "unlabeled_pairs": unmarked, "identical_source_hashes": digests[0] == digests[1],
                "sampling": False, "unique_identifiers_checked": False,
                "biological_pairing_proven": False, "mates": metrics,
                "elapsed_seconds": round(monotonic() - started, 3)}
        except (gzip.BadGzipFile, EOFError, zlib.error) as exc:
            raise LargeDataError("format_invalid") from exc
