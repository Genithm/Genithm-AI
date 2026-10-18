"""Exhaustive, bounded FASTQ quality profiles. No reads or identifiers in results.

The validator supplies uppercase ACGTN and Phred+33 bytes. NumPy is used only
for integer histogram accumulation on bounded batches, not for inference.
Position ranges pool ALL observed bases in that range; this is not FastQC.
"""
from __future__ import annotations

from bisect import bisect_left
import numpy as np

SCHEMA = "genithm-read-quality-profile/1"
ENGINE = "genithm-read-quality/1.0.0"
MAX_READ = 1024 * 1024
BATCH_BASES = 256 * 1024
BATCH_READS = 16384
# Fixed, data-independent boundaries: a given cycle always has the same bin.
BIN_ENDS = tuple(range(1, 11)) + tuple(range(20, 201, 10)) + tuple(range(300, 1001, 100)) + tuple(range(2000, 10001, 1000)) + tuple(range(20000, 100001, 10000)) + tuple(range(200000, 1000001, 100000)) + (MAX_READ,)
POSITION_COLUMNS = ["start", "end", "bases", "phred_sum", "q20_bases", "q30_bases",
                    "A", "C", "G", "T", "N", "p10", "p25", "p50", "p75", "p90"]
LENGTH_COLUMNS = ["start", "end", "reads"]
BASE_MAP = np.zeros(256, dtype=np.uint8)
for _i, _base in enumerate(b"ACGTN"):
    BASE_MAP[_base] = _i
ENDS_ARRAY = np.asarray(BIN_ENDS, dtype=np.int64)


class QualityProfile:
    """Memory depends on the configured batch/read bounds, never on file size."""

    def __init__(self):
        self.sequence = bytearray()
        self.quality = bytearray()
        self.lengths: list[int] = []
        self.quality_hist = np.zeros((len(BIN_ENDS), 94), dtype=np.uint64)
        self.base_hist = np.zeros((len(BIN_ENDS), 5), dtype=np.uint64)
        self.length_hist = [0] * len(BIN_ENDS)
        self.read_quality_hist = [0] * 94
        self.read_gc_hist = [0] * 101
        self.undefined_gc = self.maximum = 0

    def add(self, seq: bytes, qual: bytes, phred_sum: int, gc: int, canonical: int) -> None:
        """Accept a complete record AFTER strict parser validation."""
        length = len(seq)
        if self.lengths and (len(self.sequence) + length > BATCH_BASES or len(self.lengths) >= BATCH_READS):
            self._flush()
        self.sequence.extend(seq)
        self.quality.extend(qual)
        self.lengths.append(length)
        self.maximum = max(self.maximum, length)
        self.length_hist[bisect_left(BIN_ENDS, length)] += 1
        self.read_quality_hist[phred_sum // length] += 1
        if canonical:
            self.read_gc_hist[(100 * gc) // canonical] += 1
        else:
            self.undefined_gc += 1
        # A single long read may exceed BATCH_BASES, but never the parser's 1 MiB.
        if len(self.sequence) >= BATCH_BASES or len(self.lengths) >= BATCH_READS:
            self._flush()

    def _flush(self) -> None:
        if not self.lengths:
            return
        lengths = np.asarray(self.lengths, dtype=np.int64)
        starts = np.cumsum(lengths, dtype=np.int64) - lengths
        positions = np.arange(len(self.sequence), dtype=np.int64) - np.repeat(starts, lengths) + 1
        bins = np.searchsorted(ENDS_ARRAY, positions)
        quality = np.frombuffer(self.quality, dtype=np.uint8).astype(np.int64) - 33
        self.quality_hist += np.bincount(bins * 94 + quality, minlength=len(BIN_ENDS) * 94).reshape(-1, 94).astype(np.uint64)
        bases = BASE_MAP[np.frombuffer(self.sequence, dtype=np.uint8)]
        self.base_hist += np.bincount(bins * 5 + bases, minlength=len(BIN_ENDS) * 5).reshape(-1, 5).astype(np.uint64)
        # No exported numpy views refer to these buffers.
        self.sequence.clear()
        self.quality.clear()
        self.lengths.clear()

    def result(self) -> dict:
        self._flush()
        rows, lengths = [], []
        start = 1
        for i, end in enumerate(BIN_ENDS):
            count = int(self.quality_hist[i].sum())
            if count:
                histogram = [int(x) for x in self.quality_hist[i]]
                def quantile(percent: int) -> int:
                    rank = (count * percent + 99) // 100
                    total = 0
                    for quality, number in enumerate(histogram):
                        total += number
                        if total >= rank:
                            return quality
                    raise AssertionError("Histogram count invariant")
                rows.append([start, min(end, self.maximum), count,
                    sum(q * n for q, n in enumerate(histogram)), sum(histogram[20:]), sum(histogram[30:]),
                    *[int(n) for n in self.base_hist[i]], *[quantile(p) for p in (10, 25, 50, 75, 90)]])
            if self.length_hist[i]:
                lengths.append([start, min(end, self.maximum), self.length_hist[i]])
            start = end + 1
        return {"schema": SCHEMA, "engine_version": ENGINE, "sampling": False,
                "quality_encoding": "phred33_assumed", "position_binning": "fixed_ranges_all_observed_bases",
                "quantile_method": "nearest_rank_pooled_bases", "read_mean_phred_binning": "floor_integer",
                "read_gc_binning": "floor_percent_gc_over_acgt_N_excluded",
                "position_columns": POSITION_COLUMNS.copy(), "positions": rows,
                "length_columns": LENGTH_COLUMNS.copy(), "read_lengths": lengths,
                "read_mean_phred_counts": self.read_quality_hist.copy(),
                "read_gc_percent_counts": self.read_gc_hist.copy(), "undefined_gc_reads": self.undefined_gc}
