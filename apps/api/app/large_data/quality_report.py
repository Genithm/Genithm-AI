"""Checksummed, authenticated aggregate reports; no storage URLs or raw reads.

The SHA-256 detects accidental report changes. It is NOT a digital signature
and does not protect against a privileged writer who can replace both fields.
"""
from __future__ import annotations

import copy
import csv
import hashlib
import hmac
import io
import json
import math
import re

from .policy import LargeDataError
from .quality_profile import BIN_ENDS, ENGINE, LENGTH_COLUMNS, POSITION_COLUMNS, SCHEMA

HEX = re.compile(r"^[a-f0-9]{64}$")
METRIC_FIELDS = {"read_count", "base_count", "base_counts", "mean_phred", "q20_bases", "q30_bases", "gc_percent",
    "min_length", "max_length", "mean_length", "expanded_bytes", "quality_encoding", "sampling", "paired_identifiers_checked", "quality_profile"}
PROFILE_FIELDS = {"schema", "engine_version", "sampling", "quality_encoding", "position_binning", "quantile_method",
    "read_mean_phred_binning", "read_gc_binning", "position_columns", "positions", "length_columns", "read_lengths",
    "read_mean_phred_counts", "read_gc_percent_counts", "undefined_gc_reads"}
SINGLE_FIELDS = {"schema", "source_bytes", "format", "verifier_version", "verification", "scientific_scope", "metrics",
    "elapsed_seconds", "source_sha256", "report_sha256"}
PAIR_FIELDS = {"schema", "verifier_version", "verification", "scientific_scope", "source_ids", "source_sha256", "source_bytes",
    "pair_count", "explicit_mate_labels", "partially_labeled_pairs", "unlabeled_pairs", "identical_source_hashes", "sampling",
    "unique_identifiers_checked", "biological_pairing_proven", "mates", "elapsed_seconds", "report_sha256"}


def canonical(report: dict) -> bytes:
    return json.dumps(report, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False).encode("ascii")


def seal_report(report: dict) -> dict:
    if "report_sha256" in report:
        raise ValueError("Report is already sealed")
    return {**report, "report_sha256": hashlib.sha256(canonical(report)).hexdigest()}


def check_digest(report: dict) -> None:
    try:
        digest = report["report_sha256"]
        content = {k: v for k, v in report.items() if k != "report_sha256"}
        _require(isinstance(digest, str) and HEX.fullmatch(digest))
        encoded = canonical(content)
        _require(len(encoded) <= 65536)
        _require(hmac.compare_digest(digest, hashlib.sha256(encoded).hexdigest()))
    except (AssertionError, ValueError, TypeError, KeyError, OverflowError):
        raise LargeDataError("quality_report_integrity_failed", 409) from None


def brief_summary(summary):
    """List/status routes keep old aggregates, loading profile arrays on demand."""
    if not isinstance(summary, dict):
        return summary
    if "report_sha256" in summary:
        check_digest(summary)
    result = copy.deepcopy(summary)
    for metric in ([result.get("metrics")] if "metrics" in result else result.get("mates", [])):
        if isinstance(metric, dict):
            metric["quality_profile_available"] = "quality_profile" in metric
            metric.pop("quality_profile", None)
    return result


def _require(condition) -> None:
    if not condition:
        raise LargeDataError("quality_report_integrity_failed", 409)


def _uint(value):
    _require(type(value) is int and 0 <= value <= 2**53 - 1)
    return value


def _counts(value, size):
    _require(isinstance(value, list) and len(value) == size)
    return [_uint(x) for x in value]


def _finite(value):
    _require(type(value) in (int, float) and math.isfinite(value) and value >= 0)
    return value


def validate_metric(metric: dict) -> None:
    _require(isinstance(metric, dict) and set(metric) == METRIC_FIELDS)
    reads, bases = _uint(metric["read_count"]), _uint(metric["base_count"])
    minimum, maximum = _uint(metric["min_length"]), _uint(metric["max_length"])
    _require(0 < reads <= bases and 1 <= minimum <= maximum <= BIN_ENDS[-1])
    _require(metric["sampling"] is False and metric["quality_encoding"] == "phred33_assumed")
    _require(type(metric["paired_identifiers_checked"]) is bool)
    _require(set(metric["base_counts"]) == set("ACGTN"))
    base_counts = [_uint(metric["base_counts"][b]) for b in "ACGTN"]
    _require(sum(base_counts) == bases)
    q20, q30 = _uint(metric["q20_bases"]), _uint(metric["q30_bases"])
    _require(q30 <= q20 <= bases)
    mean = _finite(metric["mean_phred"])
    _require(mean <= 93 and math.isclose(_finite(metric["mean_length"]), bases / reads, rel_tol=1e-12))
    canonical_bases = bases - base_counts[4]
    if canonical_bases:
        _require(math.isclose(_finite(metric["gc_percent"]), 100 * (base_counts[1] + base_counts[2]) / canonical_bases, rel_tol=1e-12, abs_tol=1e-12))
    else:
        _require(metric["gc_percent"] is None)
    _require(_uint(metric["expanded_bytes"]) >= bases * 2)
    p = metric["quality_profile"]
    _require(isinstance(p, dict) and set(p) == PROFILE_FIELDS)
    _require(p["schema"] == SCHEMA and p["engine_version"] == ENGINE and p["sampling"] is False)
    _require(p["quality_encoding"] == "phred33_assumed")
    _require(p["position_binning"] == "fixed_ranges_all_observed_bases")
    _require(p["quantile_method"] == "nearest_rank_pooled_bases")
    _require(p["read_mean_phred_binning"] == "floor_integer")
    _require(p["read_gc_binning"] == "floor_percent_gc_over_acgt_N_excluded")
    _require(p["position_columns"] == POSITION_COLUMNS and p["length_columns"] == LENGTH_COLUMNS)
    _require(isinstance(p["positions"], list) and 1 <= len(p["positions"]) <= len(BIN_ENDS))
    sums = [0] * 9
    expected_ranges, start = [], 1
    for end in BIN_ENDS:
        expected_ranges.append((start, min(end, maximum)))
        if end >= maximum:
            break
        start = end + 1
    _require(len(p["positions"]) == len(expected_ranges))
    for row, (start, end) in zip(p["positions"], expected_ranges):
        _counts(row, len(POSITION_COLUMNS))
        _require(row[:2] == [start, end])
        n, total, a20, a30 = row[2:6]
        _require(0 < n <= reads * (end - start + 1) and a30 <= a20 <= n and total <= 93 * n)
        _require(sum(row[6:11]) == n and row[11:16] == sorted(row[11:16]) and row[15] <= 93)
        for i, value in enumerate(row[2:11]):
            sums[i] += value
    _require(sums[0] == bases and sums[2:4] == [q20, q30] and sums[4:] == base_counts)
    _require(math.isclose(sums[1] / bases, mean, rel_tol=1e-12, abs_tol=1e-12))
    _require(isinstance(p["read_lengths"], list) and 1 <= len(p["read_lengths"]) <= len(BIN_ENDS))
    last_end, count = 0, 0
    for row in p["read_lengths"]:
        _counts(row, 3)
        _require(tuple(row[:2]) in expected_ranges and row[0] > last_end and 0 < row[2] <= reads)
        _require(row[1] >= minimum)
        last_end, count = row[1], count + row[2]
    _require(count == reads and last_end == maximum)
    _require(sum(_counts(p["read_mean_phred_counts"], 94)) == reads)
    _require(sum(_counts(p["read_gc_percent_counts"], 101)) + _uint(p["undefined_gc_reads"]) == reads)


def report_for_row(row: dict, *, paired: bool = False) -> dict:
    if row.get("state") != "ready":
        raise LargeDataError("quality_report_not_ready", 409)
    report = row.get("summary")
    if not isinstance(report, dict) or "report_sha256" not in report:
        raise LargeDataError("quality_profile_not_available", 409)
    check_digest(report)
    try:
        _require(set(report) == (PAIR_FIELDS if paired else SINGLE_FIELDS))
        _require(_finite(report["elapsed_seconds"]) >= 0)
        if paired:
            _require(report["schema"] == "genithm-large-pair-result/1" and report["verifier_version"] == "genithm-large-pair/1.0.0")
            _require(report["verification"] == "both_whole_object_sha256" and report["scientific_scope"] == "ordered_paired_fastq_qc")
            _require(report["source_ids"] == [row["r1_id"], row["r2_id"]])
            _require(isinstance(report["source_sha256"], list) and len(report["source_sha256"]) == 2)
            _require(all(isinstance(x, str) and HEX.fullmatch(x) for x in report["source_sha256"]))
            _require(sum(_counts(report["source_bytes"], 2)) == row["expected_bytes"])
            _require(report["identical_source_hashes"] is (report["source_sha256"][0] == report["source_sha256"][1]))
            count = _uint(report["pair_count"])
            _require(count == row["checked_pairs"] and count > 0)
            _require(sum(_uint(report[k]) for k in ("explicit_mate_labels", "partially_labeled_pairs", "unlabeled_pairs")) == count)
            _require(all(report[k] is False for k in ("sampling", "unique_identifiers_checked", "biological_pairing_proven")))
            _require(isinstance(report["mates"], list) and len(report["mates"]) == 2)
            metrics = report["mates"]
            _require(all(m["read_count"] == count and m["paired_identifiers_checked"] is True for m in metrics))
        else:
            _require(report["schema"] == "genithm-large-data-result/1" and report["verifier_version"] == "genithm-large-data/1.1.0")
            _require(report["verification"] == "whole_object_sha256")
            _require(report["format"] == row["data_format"] and report["source_bytes"] == row["expected_bytes"])
            _require(isinstance(report["source_sha256"], str) and HEX.fullmatch(report["source_sha256"]))
            _require(report["source_sha256"] == row["expected_sha256"] == row["actual_sha256"])
            if report["metrics"] is None and report["scientific_scope"] == "bytes_only":
                raise LargeDataError("quality_profile_not_available", 409)
            _require(report["format"] in ("fastq", "fastq.gz") and report["scientific_scope"] == "full_fastq_aggregate_qc")
            _require(report["metrics"]["paired_identifiers_checked"] is False)
            metrics = [report["metrics"]]
        for metric in metrics:
            validate_metric(metric)
    except (AssertionError, KeyError, TypeError, ValueError, IndexError, OverflowError):
        raise LargeDataError("quality_report_integrity_failed", 409) from None
    return {"schema": "genithm-quality-report-envelope/1", "record_id": row["id"], "project_id": row["project_id"],
            "sources_available": row.get("sources_available", True), "report": report}


def report_tsv(envelope: dict) -> str:
    """Fixed labels and validated numbers only: filenames cannot become formulas."""
    report = envelope["report"]
    stream = io.StringIO(newline="")
    writer = csv.writer(stream, delimiter="\t", lineterminator="\n")
    writer.writerow(["# Genithm whole-file read-quality profile; not a FastQC report"])
    writer.writerow(["# record_id", envelope["record_id"]])
    writer.writerow(["# report_sha256", report["report_sha256"]])
    writer.writerow(["# sources_available", str(envelope["sources_available"]).lower()])
    writer.writerow(["# Phred+33 assumed; range quantiles use pooled bases and nearest rank; no sampling"])
    metrics = report.get("mates") or [report["metrics"]]
    hashes = report["source_sha256"] if isinstance(report["source_sha256"], list) else [report["source_sha256"]]
    for i, metric in enumerate(metrics):
        label = f"R{i + 1}" if "mates" in report else "single"
        p = metric["quality_profile"]
        writer.writerow(["# source", label, hashes[i]])
        writer.writerow(["# positions", label])
        writer.writerow(POSITION_COLUMNS)
        writer.writerows(p["positions"])
        writer.writerow(["# read_lengths", label])
        writer.writerow(LENGTH_COLUMNS)
        writer.writerows(p["read_lengths"])
        writer.writerow(["# read_mean_phred", "floor_integer", label])
        writer.writerow(["score", "reads"])
        writer.writerows(enumerate(p["read_mean_phred_counts"]))
        writer.writerow(["# read_gc_percent", "floor_percent_gc_over_acgt_N_excluded", label])
        writer.writerow(["percent", "reads"])
        writer.writerows(enumerate(p["read_gc_percent_counts"]))
        writer.writerow(["# undefined_gc_reads", p["undefined_gc_reads"]])
    return stream.getvalue()


def report_response(row: dict, format: str, *, paired: bool = False):
    from starlette.responses import Response
    envelope = report_for_row(row, paired=paired)
    content = canonical(envelope) if format == "json" else report_tsv(envelope)
    return Response(content, media_type="application/json" if format == "json" else "text/tab-separated-values",
        headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
                 "Content-Disposition": f'attachment; filename="genithm-quality-{row["id"]}.{format}"'})
