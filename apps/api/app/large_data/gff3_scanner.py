"""Bounded whole-file GFF3 feature QC for Genithm managed bioinformatics files.

Only fixed-key counts are returned. Seqids, IDs, Name, Parent, attributes,
FASTA identifiers and genomic coordinates are never copied to reports.
Feature-span totals are not union coverage; overlapping features count twice.
"""
from __future__ import annotations

import math
import re

from .policy import LargeDataError

SCHEMA = "genithm-gff3-feature-qc/1"
ENGINE = "genithm-gff3-stream/1.0.0"
MAX_LINE_BYTES = 8 * 1024 * 1024
MAX_CONTIGS = 100000
MAX_COORD = 2**53 - 1
MAX_SPAN_SUM = 2**53 - 1
MAX_FEATURES = 2**53 - 1
TYPES = ("gene_features", "transcript_features", "exon_features",
         "cds_features", "utr_features", "other_features")
STRANDS = ("plus_features", "minus_features", "unstranded_features",
           "unknown_strand_features")
COUNT_FIELDS = ("feature_rows", *TYPES, *STRANDS, "phased_cds_rows",
                "unphased_cds_rows", "contigs_seen", "total_feature_span_bp",
                "minimum_feature_bp", "maximum_feature_bp", "expanded_bytes")
METRIC_FIELDS = frozenset((*COUNT_FIELDS, "schema", "engine_version", "sampling",
                           "attributes_interpreted", "embedded_fasta",
                           "embedded_fasta_validated", "mean_feature_bp"))
INTEGER = re.compile(rb"[1-9][0-9]*\Z")
TYPE = re.compile(rb"[A-Za-z_][A-Za-z0-9_.:-]*\Z")
TAG = re.compile(rb"[A-Za-z][A-Za-z0-9_.:-]*\Z")
SCORE = re.compile(rb"[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?\Z")
HEX = b"0123456789abcdefABCDEF"


def _invalid():
    raise LargeDataError("format_invalid")


def _ascii(value: bytes, *, empty=False):
    return (bool(value) or empty) and all(33 <= b <= 126 for b in value)


def _attributes(raw: bytes):
    """Validate attribute framing without interpreting or storing private values."""
    if raw == b".":
        return
    if not raw or len(raw) > MAX_LINE_BYTES or not _ascii(raw):
        _invalid()
    for item in raw.split(b";"):
        if b"=" not in item:
            _invalid()
        key, value = item.split(b"=", 1)
        if not TAG.fullmatch(key):
            _invalid()
        pos = 0
        while True:
            pos = value.find(b"%", pos)
            if pos < 0:
                break
            if pos + 2 >= len(value) or value[pos + 1] not in HEX or value[pos + 2] not in HEX:
                _invalid()
            pos += 3


def _feature_type(value: bytes):
    if value == b"gene":
        return "gene_features"
    if value in (b"mRNA", b"transcript", b"primary_transcript",
                 b"ncRNA", b"tRNA", b"rRNA"):
        return "transcript_features"
    if value == b"exon":
        return "exon_features"
    if value == b"CDS":
        return "cds_features"
    if value in (b"UTR", b"five_prime_UTR", b"three_prime_UTR",
                 b"5UTR", b"3UTR"):
        return "utr_features"
    return "other_features"


def scan_gff3(stream, max_expanded_bytes: int, tick=lambda: None) -> dict:
    """Single bounded streaming pass with one-based inclusive span arithmetic.

    Source SHA-256 is computed by the outer verified transport. An optional
    embedded FASTA section is drained but not biologically parsed.
    """
    if type(max_expanded_bytes) is not int or max_expanded_bytes < 1:
        raise LargeDataError("resource_limit")
    count = {field: 0 for field in COUNT_FIELDS}
    contigs = set()
    seen_version = False
    in_fasta = False
    fasta_seen_header = False
    for line_no in range(1, 2**53):
        if line_no % 1024 == 1:
            tick()
        raw = stream.readline(MAX_LINE_BYTES + 1)
        if not raw:
            break
        if len(raw) > MAX_LINE_BYTES:
            raise LargeDataError("resource_limit")
        count["expanded_bytes"] += len(raw)
        if count["expanded_bytes"] > max_expanded_bytes or count["expanded_bytes"] > MAX_SPAN_SUM:
            raise LargeDataError("resource_limit")
        line = raw.removesuffix(b"\n").removesuffix(b"\r")
        if b"\x00" in line or b"\r" in line:
            _invalid()
        if not seen_version:
            if line == b"##gff-version 3":
                seen_version = True
                continue
            if not line or (line.startswith(b"#") and not line.startswith(b"##gff-version")):
                continue
            _invalid()
        if in_fasta:
            if not line:
                continue
            if line.startswith(b">"):
                if len(line) < 2 or not all(32 <= b <= 126 for b in line[1:]):
                    _invalid()
                fasta_seen_header = True
            elif not fasta_seen_header:
                _invalid()
            continue
        if line == b"##FASTA":
            in_fasta = True
            continue
        if not line or line.startswith(b"#"):
            if line.startswith(b"##gff-version"):
                _invalid()
            continue
        cols = line.split(b"\t")
        if len(cols) != 9:
            _invalid()
        seqid, source, feature, left, right, score, strand, phase, attrs = cols
        if (not _ascii(seqid) or len(seqid) > 255 or
            (source != b"." and (not _ascii(source) or len(source) > 255)) or
            not TYPE.fullmatch(feature) or
            not INTEGER.fullmatch(left) or not INTEGER.fullmatch(right) or
            strand not in (b"+", b"-", b".", b"?") or
            phase not in (b".", b"0", b"1", b"2")):
            _invalid()
        start = int(left)
        end = int(right)
        if start > MAX_COORD or end > MAX_COORD or end < start:
            _invalid()
        if score != b".":
            if not SCORE.fullmatch(score):
                _invalid()
            val = float(score)
            if not math.isfinite(val) or abs(val) > 1e12:
                _invalid()
        _attributes(attrs)
        contigs.add(seqid)
        if len(contigs) > MAX_CONTIGS:
            raise LargeDataError("resource_limit")
        length = end - start + 1
        count["feature_rows"] += 1
        count["total_feature_span_bp"] += length
        if count["feature_rows"] > MAX_FEATURES or count["total_feature_span_bp"] > MAX_SPAN_SUM:
            raise LargeDataError("resource_limit")
        count[_feature_type(feature)] += 1
        count[{b"+": "plus_features", b"-": "minus_features",
               b".": "unstranded_features", b"?": "unknown_strand_features"}[strand]] += 1
        if feature == b"CDS":
            count["phased_cds_rows" if phase != b"." else "unphased_cds_rows"] += 1
        count["minimum_feature_bp"] = (
            min(count["minimum_feature_bp"], length) if count["feature_rows"] > 1 else length)
        count["maximum_feature_bp"] = max(count["maximum_feature_bp"], length)
    if not seen_version or (in_fasta and not fasta_seen_header):
        _invalid()
    tick()
    count["contigs_seen"] = len(contigs)
    return {"schema": SCHEMA, "engine_version": ENGINE, "sampling": False,
            "attributes_interpreted": False, "embedded_fasta": in_fasta,
            "embedded_fasta_validated": False, **count,
            "mean_feature_bp": round(count["total_feature_span_bp"] / count["feature_rows"], 6)
            if count["feature_rows"] else None}


def validate_gff3_metric(metric: dict, source_bytes: int) -> None:
    """Re-validate published fixed fields, including resealed report tampering."""
    from .quality_report import _require, _uint
    _require(isinstance(metric, dict) and set(metric) == METRIC_FIELDS)
    _require(metric["schema"] == SCHEMA and metric["engine_version"] == ENGINE)
    _require(metric["sampling"] is False and metric["attributes_interpreted"] is False)
    _require(type(metric["embedded_fasta"]) is bool and metric["embedded_fasta_validated"] is False)
    nums = {field: _uint(metric[field]) for field in COUNT_FIELDS}
    n = nums["feature_rows"]
    _require(source_bytes > 0 and nums["expanded_bytes"] >= len(b"##gff-version 3\n"))
    _require(n <= nums["expanded_bytes"] and nums["contigs_seen"] <= min(n, MAX_CONTIGS))
    _require(sum(nums[x] for x in TYPES) == n and sum(nums[x] for x in STRANDS) == n)
    _require(nums["phased_cds_rows"] + nums["unphased_cds_rows"] == nums["cds_features"])
    if n:
        _require(1 <= nums["minimum_feature_bp"] <= nums["maximum_feature_bp"] <= MAX_COORD)
        _require(n * nums["minimum_feature_bp"] <= nums["total_feature_span_bp"] <=
                 n * nums["maximum_feature_bp"])
        _require(type(metric["mean_feature_bp"]) in (float, int) and
                 math.isfinite(metric["mean_feature_bp"]))
        _require(abs(metric["mean_feature_bp"] - nums["total_feature_span_bp"] / n) <= 0.000001)
    else:
        _require(nums["contigs_seen"] == nums["total_feature_span_bp"] ==
                 nums["minimum_feature_bp"] == nums["maximum_feature_bp"] == 0)
        _require(metric["mean_feature_bp"] is None)
