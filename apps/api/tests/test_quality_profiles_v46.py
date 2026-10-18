"""Independent reference calculations, boundary cases, and authenticated exports."""
from __future__ import annotations

import copy
import gzip
import hashlib
import io
import json
import math
import random
from collections import Counter
from uuid import uuid4

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.large_data.fastq_scanner import FastqScanner
from app.large_data.paired import verify_pair
from app.large_data.policy import LargeDataError
from app.large_data.quality_profile import BIN_ENDS, QualityProfile
from app.large_data.quality_report import brief_summary, canonical, report_for_row, report_tsv, seal_report, validate_metric
from app.large_data.routes import clients, router
from app.large_data.pair_routes import router as pair_router
from app.large_data.verify import verify_stream


def source(data, format="fastq"):
    return {"id": str(uuid4()), "project_id": str(uuid4()), "expected_bytes": len(data),
            "expected_sha256": hashlib.sha256(data).hexdigest(), "data_format": format}


def records_bytes(records, mate=None, newline=b"\n"):
    return b"".join(newline.join([f'@private-read-{i}'.encode() + (f'/{mate}'.encode() if mate else b""), seq, b"+", qual]) + newline
                    for i, (seq, qual) in enumerate(records))


def verified(data, format="fastq"):
    row = source(data, format)
    digest, summary = verify_stream(io.BytesIO(data), row, 100 * 1024**2)
    row.update(state="ready", actual_sha256=digest, summary=summary)
    return row


def reference(records):
    # Deliberately straightforward Python lists/Counter/sort, not vectorized code.
    by_position = {end: [] for end in BIN_ENDS}
    length_counts = Counter()
    read_quality = [0] * 94
    read_gc = [0] * 101
    undefined = 0
    maximum = max(len(seq) for seq, _ in records)
    for seq, qual in records:
        seq = seq.upper()
        length_counts[next(end for end in BIN_ENDS if end >= len(seq))] += 1
        scores = [q - 33 for q in qual]
        read_quality[sum(scores) // len(scores)] += 1
        canonical_bases = sum(b in b"ACGT" for b in seq)
        if canonical_bases:
            read_gc[100 * sum(b in b"GC" for b in seq) // canonical_bases] += 1
        else:
            undefined += 1
        for position, (base, score) in enumerate(zip(seq, scores), start=1):
            end = next(end for end in BIN_ENDS if end >= position)
            by_position[end].append((base, score))
    positions, lengths, start = [], [], 1
    for end in BIN_ENDS:
        observed = by_position[end]
        if observed:
            scores = sorted(score for _, score in observed)
            bases = Counter(base for base, _ in observed)
            quantiles = [scores[math.ceil(len(scores) * p / 100) - 1] for p in (10, 25, 50, 75, 90)]
            positions.append([start, min(end, maximum), len(scores), sum(scores), sum(q >= 20 for q in scores), sum(q >= 30 for q in scores),
                              *[bases[base] for base in b"ACGTN"], *quantiles])
        if length_counts[end]:
            lengths.append([start, min(end, maximum), length_counts[end]])
        start = end + 1
    return positions, lengths, read_quality, read_gc, undefined


@pytest.mark.parametrize("seed", range(100))
def test_profiles_match_independent_reference_for_variable_reads(seed):
    rng = random.Random(seed)
    records = []
    for _ in range(rng.randint(1, 20)):
        n = rng.choice([1, 5, 10, 11, 19, 20, 21, 100, 199, 200, 201, 999, 1000, 1001])
        records.append((bytes(rng.choices(b"ACGTNacgtn", k=n)), bytes(rng.choices(range(33, 127), k=n))))
    raw = records_bytes(records, newline=b"\r\n" if seed % 2 else b"\n")
    if seed % 3 == 0:
        raw, format = gzip.compress(raw), "fastq.gz"
    else:
        format = "fastq"
    row = verified(raw, format)
    metric = row["summary"]["metrics"]
    p = metric["quality_profile"]
    assert (p["positions"], p["read_lengths"], p["read_mean_phred_counts"], p["read_gc_percent_counts"], p["undefined_gc_reads"]) == reference(records)
    validate_metric(metric)
    assert report_for_row(row)["report"] == row["summary"]
    assert b"private-read" not in canonical(row["summary"])
    assert row["summary"]["metrics"]["sampling"] is False


def test_batch_boundaries_do_not_change_statistics(monkeypatch):
    records = [(b"ACGTN" * 42, b"I5!~?" * 42), (b"GC", b"!I")] * 501
    raw = records_bytes(records)
    expected = verified(raw)["summary"]["metrics"]
    monkeypatch.setattr("app.large_data.quality_profile.BATCH_BASES", 17)
    monkeypatch.setattr("app.large_data.quality_profile.BATCH_READS", 2)
    assert verified(raw)["summary"]["metrics"] == expected


def test_all_n_reads_and_phred_extremes_are_defined_correctly():
    records = [(b"N" * 11, b"!" * 11), (b"G", b"~"), (b"AT", b"~!")]
    row = verified(records_bytes(records))
    p = row["summary"]["metrics"]["quality_profile"]
    assert p["undefined_gc_reads"] == 1 and p["read_gc_percent_counts"][100] == 1 and p["read_gc_percent_counts"][0] == 1
    assert p["read_mean_phred_counts"][0] == 1 and p["read_mean_phred_counts"][93] == 1 and p["read_mean_phred_counts"][46] == 1
    report_for_row(row)


def test_one_megabase_read_stays_bounded_and_uses_all_65_bins():
    n = 1024**2
    row = verified(records_bytes([(b"ACGT" * (n // 4), b"I" * n)]))
    m = row["summary"]["metrics"]
    assert len(m["quality_profile"]["positions"]) == 65
    assert sum(r[2] for r in m["quality_profile"]["positions"]) == n
    assert m["quality_profile"]["positions"][-1][:2] == [1000001, n]
    assert len(canonical(row["summary"])) < 16000
    report_for_row(row)


def test_profile_buffers_release_at_bounded_batch():
    p = QualityProfile()
    for _ in range(10000):
        p.add(b"ACGT", b"IIII", 160, 2, 4)
        assert len(p.sequence) <= 256 * 1024 and len(p.lengths) <= 16384
    a = p.result()
    assert not p.sequence and not p.quality and not p.lengths
    assert p.result() == a  # Reading a completed accumulator is idempotent.


def test_multiple_gzip_members_and_no_final_newline():
    a = records_bytes([(b"AC", b"I!")]); b = records_bytes([(b"GTN", b"555")]).rstrip(b"\n")
    expected = verified(a + b)["summary"]["metrics"]["quality_profile"]
    assert verified(gzip.compress(a) + gzip.compress(b), "fastq.gz")["summary"]["metrics"]["quality_profile"] == expected


def pair_row():
    r1 = records_bytes([(b"ACGT", b"IIII"), (b"NN", b"!!")], 1)
    r2 = records_bytes([(b"ACGT", b"5555"), (b"CC", b"~~")], 2)
    rows = [source(r1), source(gzip.compress(r2), "fastq.gz")]
    summary = verify_pair([io.BytesIO(r1), io.BytesIO(gzip.compress(r2))], rows, 10000)
    return {"id": str(uuid4()), "project_id": rows[0]["project_id"], "r1_id": rows[0]["id"], "r2_id": rows[1]["id"],
            "state": "ready", "checked_pairs": 2, "expected_bytes": sum(r["expected_bytes"] for r in rows),
            "summary": summary, "sources_available": True}


def test_paired_profiles_are_separate_and_source_bound():
    row = pair_row()
    envelope = report_for_row(row, paired=True)
    assert envelope["report"]["mates"][0]["mean_phred"] != envelope["report"]["mates"][1]["mean_phred"]
    text = report_tsv(envelope)
    assert "# positions\tR1" in text and "# positions\tR2" in text and "private-read" not in text
    row["r1_id"], row["r2_id"] = row["r2_id"], row["r1_id"]
    with pytest.raises(LargeDataError, match="quality_report_integrity_failed"):
        report_for_row(row, paired=True)


def test_historical_pair_exports_preserve_source_unavailability():
    row = pair_row(); row["sources_available"] = False
    result = report_for_row(row, paired=True)
    assert result["sources_available"] is False and "# sources_available\tfalse" in report_tsv(result)


@pytest.mark.parametrize("mutation", ["count", "mean", "hash", "nan", "extra", "boolean", "quantile", "negative", "columns", "shape"])
def test_corrupt_report_is_rejected_even_when_digest_is_replaced(mutation):
    row = verified(records_bytes([(b"ACGT", b"IIII")]))
    report = row["summary"]; m = report["metrics"]; p = m["quality_profile"]
    if mutation == "count": p["positions"][0][2] += 1
    elif mutation == "mean": m["mean_phred"] = 12
    elif mutation == "hash": report["source_sha256"] = "a" * 64
    elif mutation == "nan": m["mean_phred"] = float("nan")
    elif mutation == "extra": p["private_object_key"] = "secret/path"
    elif mutation == "boolean": p["positions"][0][2] = True
    elif mutation == "quantile": p["positions"][0][13] = 94
    elif mutation == "negative": p["read_mean_phred_counts"][0] = -1
    elif mutation == "columns": p["position_columns"] = ["wrong"]
    elif mutation == "shape": p["positions"] *= 100
    if mutation != "nan":
        report.pop("report_sha256"); row["summary"] = seal_report(report)
    with pytest.raises(LargeDataError, match="quality_report_integrity_failed"):
        report_for_row(row)


def test_digest_detects_changes_and_brief_routes_do_not_export_profile_arrays():
    row = verified(records_bytes([(b"AC", b"II")]))
    summary = row["summary"]
    brief = brief_summary(summary)
    assert brief["metrics"]["quality_profile_available"] is True
    assert "quality_profile" not in brief["metrics"] and "quality_profile" in summary["metrics"]
    summary["metrics"]["read_count"] += 1
    with pytest.raises(LargeDataError, match="quality_report_integrity_failed"):
        brief_summary(summary)


def test_old_and_opaque_results_do_not_acquire_fake_profiles():
    row = verified(records_bytes([(b"AC", b"II")]))
    row["summary"].pop("report_sha256")
    row["summary"]["metrics"].pop("quality_profile")
    assert brief_summary(row["summary"])["metrics"]["quality_profile_available"] is False
    with pytest.raises(LargeDataError, match="quality_profile_not_available"):
        report_for_row(row)
    with pytest.raises(LargeDataError, match="quality_profile_not_available"):
        report_for_row(verified(b"arbitrary bytes", "opaque"))


@pytest.fixture
def api(monkeypatch):
    monkeypatch.setenv("GENITHM_LARGE_DATA_PAIRING_ENABLED", "true")
    single = verified(records_bytes([(b"ACGT", b"I5!~")]))
    pair = pair_row()
    calls = []
    class Client:
        def auth(self, header):
            if header != "Bearer owner":
                raise HTTPException(401, "authentication_required")
            return "owner"
        def rpc(self, name, **params):
            calls.append((name, params))
            row = pair if name == "pair_get" else single
            if params["p_id"] != row["id"]:
                raise LargeDataError("not_found", 404)
            assert params["p_owner"] == "owner"
            return copy.deepcopy(row)
    app = FastAPI(); app.include_router(router); app.include_router(pair_router)
    app.dependency_overrides[clients] = Client
    return TestClient(app), single, pair, calls


@pytest.mark.parametrize("kind", ["uploads", "pairs"])
def test_report_endpoints_recheck_auth_and_owner_before_export(api, kind):
    client, single, pair, calls = api
    row = single if kind == "uploads" else pair
    path = f'/api/v1/large-data/{kind}/{row["id"]}/quality-report'
    assert client.get(path).status_code == 401 and not calls
    assert client.get(f'/api/v1/large-data/{kind}/{uuid4()}/quality-report', headers={"Authorization": "Bearer owner"}).status_code == 404
    for format in ("json", "tsv"):
        response = client.get(path + "?format=" + format, headers={"Authorization": "Bearer owner"})
        assert response.status_code == 200, response.text
        assert response.headers["cache-control"] == "no-store" and response.headers["x-content-type-options"] == "nosniff"
        assert response.headers["content-disposition"].endswith(f'.{format}"')
        assert "private-read" not in response.text and "object_key" not in response.text and "operation_token" not in response.text
    assert client.get(path + "?format=html", headers={"Authorization": "Bearer owner"}).status_code == 422
    row["state"] = "verifying"
    assert client.get(path, headers={"Authorization": "Bearer owner"}).json()["detail"] == "quality_report_not_ready"


def test_disabled_pair_processing_does_not_expose_reports(api, monkeypatch):
    client, _, pair, calls = api
    monkeypatch.delenv("GENITHM_LARGE_DATA_PAIRING_ENABLED")
    response = client.get(f'/api/v1/large-data/pairs/{pair["id"]}/quality-report', headers={"Authorization": "Bearer owner"})
    assert response.status_code == 503 and not calls


def test_report_validation_stays_enabled_with_optimized_python():
    import os, subprocess, sys
    code = """
import hashlib, io
from app.large_data.verify import verify_stream
from app.large_data.quality_report import validate_metric
from app.large_data.policy import LargeDataError
raw=b'@x\\nAC\\n+\\nII\\n'
row={'expected_sha256':hashlib.sha256(raw).hexdigest(),'expected_bytes':len(raw),'data_format':'fastq'}
_,report=verify_stream(io.BytesIO(raw),row,1024)
m=report['metrics'];m['read_count']=False
try:
    validate_metric(m)
except LargeDataError:
    pass
else:
    raise RuntimeError('Optimized Python disabled report validation')
"""
    subprocess.run([sys.executable,"-O","-c",code],check=True,capture_output=True,text=True,env=os.environ.copy())
