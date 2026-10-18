"""Bounded paired-read scanner, reference-tested against the existing single-file path."""
from .policy import LargeDataError
from .verify import MAX_READ_BYTES, MAX_HEADER_BYTES, VALID_BASE, INVALID_QUAL, Q20, Q30


class FastqScanner:
    """Paired scanner: retain aggregates, not reads; old single-source path is unchanged."""
    def __init__(self, stream, max_expanded_bytes, tick=lambda: None):
        self.stream, self.limit, self.tick = stream, max_expanded_bytes, tick
        self.records = self.bases = self.quality_sum = self.q20 = self.q30 = self.expanded = 0
        self.counts = {base: 0 for base in "ACGTN"}
        self.minimum, self.maximum = MAX_READ_BYTES + 1, 0

    def _line(self, limit):
        data = self.stream.readline(limit + 2)
        self.expanded += len(data)
        if self.expanded > self.limit:
            raise LargeDataError("resource_limit")
        value = data.removesuffix(b"\n").removesuffix(b"\r")
        if len(value) > limit:
            raise LargeDataError("resource_limit")
        return value, bool(data)

    def next_header(self):
        """Validate/accumulate one whole record, return only its bounded header."""
        self.tick()
        header, exists = self._line(MAX_HEADER_BYTES)
        if not exists:
            return None
        seq, a = self._line(MAX_READ_BYTES)
        plus, b = self._line(MAX_HEADER_BYTES)
        qual, c = self._line(MAX_READ_BYTES)
        if (not header.startswith(b"@") or len(header) < 2 or not header[1:].strip() or
            any(ch < 32 or ch == 127 for ch in header) or not (a and b and c) or
            not plus.startswith(b"+") or (len(plus) > 1 and plus[1:] != header[1:]) or
            not seq or len(seq) != len(qual)):
            raise LargeDataError("format_invalid")
        seq = seq.upper()
        if seq.translate(VALID_BASE).count(b"\x01") or qual.translate(INVALID_QUAL).count(b"\x01"):
            raise LargeDataError("format_invalid")
        self.records += 1
        self.bases += len(seq)
        self.minimum, self.maximum = min(self.minimum, len(seq)), max(self.maximum, len(seq))
        for base in self.counts:
            self.counts[base] += seq.count(base.encode())
        self.quality_sum += sum(qual) - 33 * len(qual)
        self.q20 += qual.translate(Q20).count(b"\x01")
        self.q30 += qual.translate(Q30).count(b"\x01")
        return header

    def result(self):
        if not self.records:
            raise LargeDataError("format_invalid")
        canonical = self.bases - self.counts["N"]
        return {"read_count": self.records, "base_count": self.bases, "base_counts": self.counts.copy(),
            "mean_phred": self.quality_sum / self.bases, "q20_bases": self.q20, "q30_bases": self.q30,
            "gc_percent": 100 * (self.counts["G"] + self.counts["C"]) / canonical if canonical else None,
            "min_length": self.minimum, "max_length": self.maximum, "mean_length": self.bases / self.records,
            "expanded_bytes": self.expanded, "quality_encoding": "phred33_assumed",
            "sampling": False, "paired_identifiers_checked": False}
