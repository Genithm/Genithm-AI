"""Bounded, complete VCF 4.x site-level QC for the managed large-file verifier.

The scanner never retains identifiers, genotypes, alleles, contig names or rows
in returned output. It validates fixed columns, not FORMAT/INFO semantics or
reference-genome correctness. Memory usage is independent of total input size.
"""
from __future__ import annotations

import math
import re
from .policy import LargeDataError

SCHEMA = "genithm-vcf-site-qc/1"
ENGINE = "genithm-vcf-stream/1.0.0"
MAX_LINE_BYTES = 16 * 1024 * 1024
MAX_CONTIGS = 100000
MAX_SAMPLES = 100000
MAX_ALLELE_BYTES = 1000000
FIELD_NAMES = (b"#CHROM", b"POS", b"ID", b"REF", b"ALT", b"QUAL", b"FILTER", b"INFO")
REF = re.compile(rb"[ACGTNacgtn]+\Z")
ALT_LITERAL = re.compile(rb"[ACGTNacgtn]+\Z")
ALT_SYMBOLIC = re.compile(rb"<[A-Za-z0-9_:.+-]+>\Z")
ALT_BREAKEND = re.compile(rb"[ACGTNacgtn.]*([\[\]])[A-Za-z0-9_.-]{1,255}:[1-9][0-9]*\1[ACGTNacgtn.]*\Z")
FILTER_TOKEN = re.compile(rb"[A-Za-z0-9_.:-]+\Z")
INTEGER = re.compile(rb"(?:0|[1-9][0-9]*)\Z")
QUALITY = re.compile(rb"(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?\Z")
METRIC_FIELDS = frozenset({
    "schema", "engine_version", "sampling", "genotypes_inspected", "record_count", "sample_count",
    "contigs_seen", "snv_sites", "mnv_sites", "indel_sites", "complex_sites", "symbolic_sites",
    "reference_only_sites", "multiallelic_sites", "canonical_snv_alt_alleles", "transitions",
    "transversions", "pass_sites", "failed_filter_sites", "unfiltered_sites",
    "quality_available_sites", "missing_quality_sites", "mean_qual", "expanded_bytes",
})


def _invalid():
    raise LargeDataError("format_invalid")


def _ascii_visible(value: bytes, *, empty=False) -> bool:
    return (bool(value) or empty) and all(33 <= char <= 126 for char in value)


def _alt_type(ref: bytes, alt_field: bytes):
    """One mutually exclusive site class; Ti/Tv counts individual canonical SNV ALTs."""
    if alt_field == b".":
        return "reference_only_sites", 0, 0, 0, False
    alts = alt_field.split(b",")
    if len(alts) > 10000 or any(not a or len(a) > MAX_ALLELE_BYTES for a in alts):
        _invalid()
    literal = []
    special = False
    for alt in alts:
        if ALT_LITERAL.fullmatch(alt):
            literal.append(alt.upper())
        elif alt == b"*" or ALT_SYMBOLIC.fullmatch(alt) or ALT_BREAKEND.fullmatch(alt):
            special = True
        else:
            _invalid()
    transitions = transversions = 0
    if len(ref) == 1 and ref in b"ACGT":
        for alt in literal:
            if len(alt) == 1 and alt in (b"A", b"C", b"G", b"T") and alt != ref:
                if (ref + alt) in (b"AG", b"GA", b"CT", b"TC"):
                    transitions += 1
                else:
                    transversions += 1
    if special:
        category = "symbolic_sites"
    elif all(len(a) == len(ref) == 1 and a != ref for a in literal):
        category = "snv_sites"
    elif any(len(a) != len(ref) for a in literal):
        category = "indel_sites"
    elif len(ref) > 1 and all(len(a) == len(ref) and a != ref for a in literal):
        category = "mnv_sites"
    else:
        category = "complex_sites"
    return category, transitions, transversions, len(alts), len(alts) > 1


def scan_vcf(stream, max_expanded_bytes: int, tick=lambda: None) -> dict:
    """Read every VCF line once with bounded line length and bounded contig set.

    This deliberately does not validate sample GT/FORMAT or INFO values, nor
    sort order/genome assembly. Unknown QUAL and FILTER have separate counters.
    """
    if type(max_expanded_bytes) is not int or max_expanded_bytes < 1:
        raise LargeDataError("resource_limit")
    counts = {key: 0 for key in METRIC_FIELDS if key.endswith("_sites") or key in (
        "record_count", "canonical_snv_alt_alleles", "transitions", "transversions")}
    expanded = 0
    quality_total = 0.0
    sample_count = None
    contigs = set()
    header_seen = False
    for row_number in range(1, 2**53):
        if row_number % 1024 == 1:
            tick()
        raw = stream.readline(MAX_LINE_BYTES + 1)
        if not raw:
            break
        expanded += len(raw)
        if len(raw) > MAX_LINE_BYTES:
            raise LargeDataError("resource_limit")
        if expanded > max_expanded_bytes:
            raise LargeDataError("resource_limit")
        line = raw.removesuffix(b"\n").removesuffix(b"\r")
        if b"\x00" in line or b"\r" in line:
            _invalid()
        if row_number == 1:
            if not re.fullmatch(rb"##fileformat=VCFv4\.[0-5]", line):
                _invalid()
            continue
        if not header_seen and line.startswith(b"##"):
            # Metadata may contain tabs/quoted descriptions; it is never run or echoed.
            if not line[2:] or any(b < 32 and b != 9 or b == 127 for b in line):
                _invalid()
            continue
        if not header_seen:
            columns = line.split(b"\t")
            if (columns[:8] != list(FIELD_NAMES) or len(columns) == 9 or
                (len(columns) > 8 and columns[8] != b"FORMAT") or
                len(columns) > MAX_SAMPLES + 9):
                _invalid()
            if len(columns) > 8 and (any(not _ascii_visible(name) for name in columns[9:]) or
                                      len(set(columns[9:])) != len(columns[9:])):
                _invalid()
            sample_count = len(columns) - 9 if len(columns) > 8 else 0
            header_seen = True
            continue
        if line.startswith(b"#") or not line:
            _invalid()
        cols = line.split(b"\t")
        if len(cols) != 8 + (1 + sample_count if sample_count else 0):
            _invalid()
        chrom, pos, ident, ref, alt, qual, flt, info = cols[:8]
        if (not _ascii_visible(chrom) or len(chrom) > 255 or
            not INTEGER.fullmatch(pos) or int(pos) < 1 or int(pos) > 2**31 - 1 or
            not _ascii_visible(ident) or not REF.fullmatch(ref) or len(ref) > MAX_ALLELE_BYTES or
            not _ascii_visible(info) or not _ascii_visible(flt)):
            _invalid()
        if sample_count and (not _ascii_visible(cols[8]) or any(not sample for sample in cols[9:])):
            _invalid()
        # Contig names are held only in a bounded set for numeric cardinality.
        contigs.add(chrom)
        if len(contigs) > MAX_CONTIGS:
            raise LargeDataError("resource_limit")
        ref = ref.upper()
        category, ti, tv, allele_count, multi = _alt_type(ref, alt)
        counts["record_count"] += 1
        counts[category] += 1
        counts["transitions"] += ti
        counts["transversions"] += tv
        counts["canonical_snv_alt_alleles"] += ti + tv
        counts["multiallelic_sites"] += int(multi)
        if flt == b"PASS":
            counts["pass_sites"] += 1
        elif flt == b".":
            counts["unfiltered_sites"] += 1
        else:
            codes = flt.split(b";")
            if any(not FILTER_TOKEN.fullmatch(code) or code == b"PASS" for code in codes) or len(set(codes)) != len(codes):
                _invalid()
            counts["failed_filter_sites"] += 1
        if qual == b".":
            counts["missing_quality_sites"] += 1
        else:
            if not QUALITY.fullmatch(qual):
                _invalid()
            value = float(qual)
            if not math.isfinite(value) or not 0 <= value <= 1000000:
                _invalid()
            counts["quality_available_sites"] += 1
            quality_total += value
    if not header_seen or sample_count is None:
        _invalid()
    tick()
    return {
        "schema": SCHEMA, "engine_version": ENGINE, "sampling": False, "genotypes_inspected": False,
        **counts, "sample_count": sample_count, "contigs_seen": len(contigs), "expanded_bytes": expanded,
        "mean_qual": round(quality_total / counts["quality_available_sites"], 6)
        if counts["quality_available_sites"] else None,
    }


def validate_vcf_metric(metric: dict, source_bytes: int) -> None:
    """Recheck every published integer, bound, scope and cross-field invariant."""
    from .quality_report import _require, _uint, _finite
    _require(isinstance(metric, dict) and set(metric) == METRIC_FIELDS)
    _require(metric["schema"] == SCHEMA and metric["engine_version"] == ENGINE)
    _require(metric["sampling"] is False and metric["genotypes_inspected"] is False)
    vals = {key: _uint(metric[key]) for key in METRIC_FIELDS if key.endswith("_sites") or key in (
        "record_count", "canonical_snv_alt_alleles", "transitions", "transversions",
        "sample_count", "contigs_seen", "expanded_bytes")}
    n = vals["record_count"]
    _require(vals["sample_count"] <= MAX_SAMPLES and vals["contigs_seen"] <= min(MAX_CONTIGS, n))
    _require(source_bytes > 0 and vals["expanded_bytes"] >= 45)
    _require(sum(vals[x] for x in ("snv_sites", "mnv_sites", "indel_sites", "complex_sites",
                                    "symbolic_sites", "reference_only_sites")) == n)
    _require(sum(vals[x] for x in ("pass_sites", "failed_filter_sites", "unfiltered_sites")) == n)
    _require(sum(vals[x] for x in ("quality_available_sites", "missing_quality_sites")) == n)
    _require(vals["multiallelic_sites"] <= n)
    _require(vals["canonical_snv_alt_alleles"] == vals["transitions"] + vals["transversions"])
    _require(vals["canonical_snv_alt_alleles"] <= max(1, n) * 10000)
    mean = metric["mean_qual"]
    if vals["quality_available_sites"]:
        _require(mean is not None and _finite(mean) <= 1000000)
    else:
        _require(mean is None)