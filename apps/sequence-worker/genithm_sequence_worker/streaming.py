"""One-pass, bounded-fragment FASTA validation and scientific statistics.

The original byte validators remain the independent numerical reference.
No full sequence, full file or per-record sequence is retained by this module.
Header fingerprints are retained solely to detect duplicate-header warnings.
"""
from __future__ import annotations

import codecs
import re
from collections import Counter
from collections.abc import Iterable
from hashlib import sha256
from typing import BinaryIO

from .statistics import CANONICAL_NUCLEOTIDES, GC_METHOD, STATISTICS_VERSION, SequenceStatistics
from .validator import (
    FastaValidationError, GAP_CHARS, MAX_FILE_BYTES, MAX_HEADER_CHARS,
    MAX_RECORDS, NUCLEIC, PROTEIN, ValidationResult, _classify,
)

CHUNK_BYTES = 64 * 1024
# Same line boundaries as str.splitlines(); CRLF is treated as a single boundary.
_LINE_END = re.compile(r"[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]")
_ALLOWED = NUCLEIC | PROTEIN | GAP_CHARS


class FastaTransferError(RuntimeError):
    """A transport or declared-size violation, not biological rejection."""


class FastaStreamValidationError(FastaValidationError):
    """Scientific rejection with a digest only after all declared bytes arrived."""

    def __init__(self, message: str, digest: str) -> None:
        super().__init__(message)
        self.sha256 = digest


class _Scanner:
    def __init__(self) -> None:
        self.line_number = 1
        self.kind = "empty"
        self.skip_lf = False
        self.header = ""
        self.header_tail = ""
        self.header_tail_size = 0
        self.header_hashes: set[bytes] = set()
        self.duplicate_headers = False
        self.saw_header = False
        self.sequence_count = 0
        self.record_length = 0
        self.min_length: int | None = None
        self.max_length = 0
        self.composition: Counter[str] = Counter()
        self.all_residues: set[str] = set()
        self.gap_count = 0
        self.sequence_whitespace = False
        self.seq_started = False
        self.seq_tail_space = False

    def _header_piece(self, part: str) -> None:
        # Ignore leading and trailing header whitespace exactly as header.strip().
        if not self.header:
            part = part.lstrip()
        core = part.rstrip()
        tail_len = len(part) - len(core)
        if core:
            if len(self.header) + self.header_tail_size + len(core) > MAX_HEADER_CHARS:
                raise FastaValidationError(
                    f"Header on line {self.line_number} exceeds {MAX_HEADER_CHARS} characters"
                )
            self.header += self.header_tail + core
            self.header_tail = part[len(core):][:MAX_HEADER_CHARS + 1]
            self.header_tail_size = tail_len
        elif self.header:
            self.header_tail_size += len(part)
            self.header_tail = (self.header_tail + part)[:MAX_HEADER_CHARS + 1]

    def _sequence_piece(self, part: str) -> None:
        trimmed = part.strip()
        if not trimmed:
            if self.seq_started and part:
                self.seq_tail_space = True
            return
        if not self.saw_header:
            raise FastaValidationError(
                f"Sequence data appears before the first FASTA header on line {self.line_number}"
            )
        upper = trimmed.upper()
        normalized = "".join(upper.split())
        if len(normalized) != len(upper) or (
            self.seq_started and (self.seq_tail_space or part[0].isspace())
        ):
            self.sequence_whitespace = True
        self.seq_started = True
        self.seq_tail_space = part[-1].isspace()
        counts = Counter(normalized)
        invalid = counts.keys() - _ALLOWED
        if invalid:
            sample = "".join(sorted(invalid))[:12]
            raise FastaValidationError(
                f"Unsupported residue characters on line {self.line_number}: {sample}"
            )
        self.all_residues.update(counts)
        gaps = counts.pop("-", 0) + counts.pop(".", 0)
        self.gap_count += gaps
        self.record_length += len(normalized) - gaps
        self.composition.update(counts)

    def _piece(self, part: str) -> None:
        if not part:
            return
        if self.kind == "empty":
            part = part.lstrip()
            if not part:
                return
            if part.startswith(">"):
                self.kind = "header"
                part = part[1:]
            else:
                self.kind = "sequence"
        if self.kind == "header":
            self._header_piece(part)
        else:
            self._sequence_piece(part)

    def _record_end(self, *, final: bool) -> None:
        if self.record_length == 0:
            raise FastaValidationError(
                "Final FASTA record has no sequence" if final else
                f"Record before line {self.line_number} has no sequence"
            )
        self.min_length = self.record_length if self.min_length is None else min(self.min_length, self.record_length)
        self.max_length = max(self.max_length, self.record_length)

    def _line_end(self) -> None:
        if self.kind == "header":
            if self.saw_header:
                self._record_end(final=False)
            if not self.header:
                raise FastaValidationError(f"Header on line {self.line_number} is empty")
            self.sequence_count += 1
            if self.sequence_count > MAX_RECORDS:
                raise FastaValidationError(f"FASTA exceeds the {MAX_RECORDS} record limit")
            # Collision-resistant comparison avoids keeping identifying header text.
            fingerprint = sha256(self.header.encode("utf-8")).digest()
            if fingerprint in self.header_hashes:
                self.duplicate_headers = True
            self.header_hashes.add(fingerprint)
            self.header = self.header_tail = ""
            self.header_tail_size = 0
            self.record_length = 0
            self.saw_header = True
        self.kind = "empty"
        self.seq_started = self.seq_tail_space = False
        self.line_number += 1

    def feed(self, text: str) -> None:
        if not text:
            return
        if self.skip_lf:
            if text.startswith("\n"):
                text = text[1:]
            self.skip_lf = False
        start = 0
        for match in _LINE_END.finditer(text):
            pos = match.start()
            # Consume LF after a CR in the same fragment without a second line.
            if pos < start:
                continue
            self._piece(text[start:pos])
            self._line_end()
            start = pos + 1
            if text[pos] == "\r":
                if start == len(text):
                    self.skip_lf = True
                elif text[start] == "\n":
                    start += 1
        self._piece(text[start:])

    def finish(self, digest: str) -> tuple[ValidationResult, SequenceStatistics]:
        if self.kind != "empty":
            self._line_end()
        if not self.saw_header:
            raise FastaValidationError("FASTA contains no records")
        self._record_end(final=True)
        residues = sum(self.composition.values())
        seq_type = _classify(self.all_residues)
        warnings = []
        if self.duplicate_headers:
            warnings.append("duplicate_headers")
        if self.sequence_whitespace:
            warnings.append("sequence_whitespace_ignored")
        if self.gap_count:
            warnings.append("gap_characters_present")
        validation = ValidationResult(digest, seq_type, self.sequence_count, residues, tuple(warnings))
        composition = dict(sorted(self.composition.items()))
        denominator = None
        gc = None
        method = None
        if seq_type in {"dna", "rna", "mixed"}:
            denominator = sum(self.composition[x] for x in CANONICAL_NUCLEOTIDES)
            method = GC_METHOD
            if denominator:
                gc = round(100.0 * (self.composition["G"] + self.composition["C"]) / denominator, 6)
        stats = SequenceStatistics(
            statistics_version=STATISTICS_VERSION, sequence_type=seq_type,
            sequence_count=self.sequence_count, residue_count=residues,
            min_record_length=self.min_length or 0, max_record_length=self.max_length,
            mean_record_length=round(residues / self.sequence_count, 6),
            composition=composition,
            frequencies={k: round(v / residues, 10) for k, v in composition.items()},
            gap_count=self.gap_count, gc_content_percent=gc,
            gc_denominator_count=denominator, gc_method=method,
        )
        return validation, stats


def analyze_fasta_chunks(
    chunks: Iterable[bytes], *, expected_size: int | None = None,
) -> tuple[ValidationResult, SequenceStatistics]:
    """Scan bounded fragments once, checking the *raw* byte hash and exact size.

    Even after a format rejection the bounded transfer is drained so the stored
    rejected-file digest is of the complete object, never a prefix. Failed or
    oversized transfers never generate a successful result or a trusted digest.
    """
    if expected_size is not None and (
        type(expected_size) is not int or not 1 <= expected_size <= MAX_FILE_BYTES
    ):
        raise FastaTransferError("Declared sequence size is outside the 1..50 MiB limit")
    scanner = _Scanner()
    decoder = codecs.getincrementaldecoder("utf-8-sig")("strict")
    digest = sha256()
    total = 0
    nul = False
    utf8_error = False
    format_error: FastaValidationError | None = None
    for chunk in chunks:
        if not isinstance(chunk, bytes):
            raise FastaTransferError("Sequence transport must produce byte chunks")
        total += len(chunk)
        if total > MAX_FILE_BYTES or (expected_size is not None and total > expected_size):
            raise FastaTransferError("Downloaded sequence exceeds declared or maximum size")
        digest.update(chunk)
        nul = nul or b"\0" in chunk
        for start in range(0, len(chunk), CHUNK_BYTES):
            if utf8_error:
                break
            try:
                text = decoder.decode(chunk[start:start + CHUNK_BYTES])
            except UnicodeDecodeError:
                utf8_error = True
                break
            if format_error is None:
                try:
                    scanner.feed(text)
                except FastaValidationError as exc:
                    format_error = exc
    if expected_size is not None and total != expected_size:
        raise FastaTransferError("Downloaded sequence does not match its declared size")
    if not utf8_error:
        try:
            tail = decoder.decode(b"", final=True)
            if format_error is None:
                scanner.feed(tail)
        except UnicodeDecodeError:
            utf8_error = True
        except FastaValidationError as exc:
            format_error = exc
    # Match the original full-byte decoder's validation precedence.
    if not total:
        error = "FASTA input is empty"
    elif nul:
        error = "Binary NUL bytes are not valid FASTA input"
    elif utf8_error:
        error = "FASTA input must be UTF-8 text"
    elif format_error is not None:
        error = str(format_error)
    else:
        try:
            return scanner.finish(digest.hexdigest())
        except FastaValidationError as exc:
            error = str(exc)
    raise FastaStreamValidationError(error, digest.hexdigest())


def analyze_fasta_stream(
    stream: BinaryIO, *, expected_size: int,
) -> tuple[ValidationResult, SequenceStatistics]:
    def chunks() -> Iterable[bytes]:
        remaining = expected_size + 1
        while remaining:
            chunk = stream.read(min(CHUNK_BYTES, remaining))
            if not chunk:
                return
            remaining -= len(chunk)
            yield chunk
    return analyze_fasta_chunks(chunks(), expected_size=expected_size)
