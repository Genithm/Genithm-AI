"""Inert-file inspection metadata and integrity-bound JSON exports."""
from __future__ import annotations

import math
from .file_registry import VERSION, HEADER_KINDS, describe, header_kind, storage_format
from .fasta import SYMBOLS
from .policy import LargeDataError

FIELDS = {"schema", "registry_version", "mode", "name_hint", "observed_header", "prefix_bytes_inspected",
          "inspection", "archive_extraction", "malware_scan", "fasta", "warnings"}
FASTA_FIELDS = {"schema", "record_count", "symbol_count", "minimum_length", "maximum_length", "mean_length",
               "symbol_counts", "expanded_bytes", "sampling", "alphabet_interpretation", "duplicate_identifiers_checked"}


def warnings_for(hint: dict, mode: str, observed: str) -> list[str]:
    result = []
    if hint["format_id"] == "unknown":
        result.append("unrecognized_name_preserved")
    if mode == "preserve":
        result.append("inspection_explicitly_disabled")
    if hint["compression_hint"] not in {"none", "gzip"} or (hint["compression_hint"] == "gzip" and (mode == "preserve" or hint["available_inspection"] == "integrity_only")):
        result.append("compressed_contents_not_validated")
    if hint["format_id"] == "archive" or observed in {"zip", "7zip", "rar"}:
        result.append("archive_not_extracted")
    if observed in {"elf", "pe"}:
        result.append("executable_header_stored_as_inert_bytes")
    return result


def build_intake(row: dict, prefix: bytes, *, fasta: dict | None = None) -> dict:
    hint = describe(row["original_filename"])
    observed = header_kind(prefix)
    mode = row["intake_mode"]
    inspection = "complete_fasta" if fasta is not None else (
        "complete_fastq" if mode == "auto" and row["data_format"] in {"fastq", "fastq.gz"} else "integrity_only")
    return {"schema": "genithm-file-intake/1", "registry_version": VERSION, "mode": mode,
        "name_hint": hint, "observed_header": observed, "prefix_bytes_inspected": len(prefix),
        "inspection": inspection, "archive_extraction": "not_performed", "malware_scan": "not_performed",
        "fasta": fasta, "warnings": warnings_for(hint, mode, observed)}


def require(value):
    if not value:
        raise LargeDataError("file_report_integrity_failed", 409)


def uint(value):
    require(type(value) is int and 0 <= value <= 2**53 - 1)
    return value


def validate_fasta(value):
    require(isinstance(value, dict) and set(value) == FASTA_FIELDS)
    require(value["schema"] == "genithm-fasta-summary/1")
    records, symbols = uint(value["record_count"]), uint(value["symbol_count"])
    minimum, maximum = uint(value["minimum_length"]), uint(value["maximum_length"])
    require(0 < records <= symbols and 0 < minimum <= maximum <= symbols)
    require(records * minimum <= symbols <= records * maximum)
    require(type(value["mean_length"]) in (int, float) and math.isfinite(value["mean_length"]))
    require(math.isclose(value["mean_length"], symbols / records, rel_tol=1e-12))
    require(isinstance(value["symbol_counts"], dict) and set(value["symbol_counts"]) == set(SYMBOLS))
    require(sum(uint(n) for n in value["symbol_counts"].values()) == symbols)
    require(uint(value["expanded_bytes"]) >= symbols + records * 2)
    require(value["sampling"] is False and value["duplicate_identifiers_checked"] is False)
    require(value["alphabet_interpretation"] == "unassigned")


def validate_intake(row: dict, report: dict):
    intake = report["intake"]
    require(isinstance(intake, dict) and set(intake) == FIELDS)
    require(intake["schema"] == "genithm-file-intake/1" and intake["registry_version"] == VERSION)
    mode = row["intake_mode"]
    require(mode in {"auto", "preserve"} and intake["mode"] == mode)
    require(intake["name_hint"] == describe(row["original_filename"]))
    require(row["data_format"] == storage_format(row["original_filename"], mode))
    require(type(intake["observed_header"]) is str and intake["observed_header"] in HEADER_KINDS)
    require(uint(intake["prefix_bytes_inspected"]) == min(row["expected_bytes"], 65536))
    require(intake["archive_extraction"] == intake["malware_scan"] == "not_performed")
    require(intake["warnings"] == warnings_for(intake["name_hint"], mode, intake["observed_header"]))
    expected = intake["name_hint"]["available_inspection"] if mode == "auto" else "integrity_only"
    require(intake["inspection"] == expected)
    if expected == "complete_fasta":
        validate_fasta(intake["fasta"])
        require(report["metrics"] is None and report["scientific_scope"] == "full_fasta_structural_summary")
    else:
        require(intake["fasta"] is None)
        require(report["scientific_scope"] == ("full_fastq_aggregate_qc" if expected == "complete_fastq" else "bytes_only"))
        if expected == "integrity_only":
            require(report["metrics"] is None and row["data_format"] == "opaque")


def file_report(row: dict) -> dict:
    from .quality_report import check_digest, SINGLE_FIELDS, report_for_row
    if row.get("state") != "ready":
        raise LargeDataError("file_report_not_ready", 409)
    report = row.get("summary")
    if not isinstance(report, dict) or "report_sha256" not in report:
        raise LargeDataError("file_report_not_available", 409)
    check_digest(report)
    try:
        modern = row.get("intake_mode", "legacy") != "legacy"
        require(set(report) == (SINGLE_FIELDS | {"intake"} if modern else SINGLE_FIELDS))
        require(report["schema"] == "genithm-large-data-result/1" and report["verification"] == "whole_object_sha256")
        require(report["verifier_version"] == ("genithm-large-data/1.2.0" if modern else "genithm-large-data/1.1.0"))
        require(uint(report["source_bytes"]) == uint(row["expected_bytes"]) == uint(row["checked_bytes"]))
        require(report["source_sha256"] == row["expected_sha256"] == row["actual_sha256"])
        require(report["format"] == row["data_format"])
        require(type(report["elapsed_seconds"]) in (int, float) and math.isfinite(report["elapsed_seconds"]) and report["elapsed_seconds"] >= 0)
        if modern:
            validate_intake(row, report)
        if report["metrics"] is not None:
            report_for_row(row)
        elif not modern:
            require(report["scientific_scope"] == "bytes_only" and report["format"] == "opaque")
    except (KeyError, TypeError, ValueError, IndexError, OverflowError):
        raise LargeDataError("file_report_integrity_failed", 409) from None
    return {"schema": "genithm-file-report-envelope/1", "record_id": row["id"], "project_id": row["project_id"],
        "relative_path": row.get("relative_path") or row["original_filename"], "batch_id": row.get("batch_id"),
        "report": report}
