from __future__ import annotations

import gzip
import hashlib
import io
import random
import threading
from types import SimpleNamespace
from unittest.mock import Mock
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from app.large_data.policy import LargeDataError
from app.large_data.paired import mate_identifier, verify_pair
from app.large_data.pair_worker import process_pair
from app.large_data.pair_routes import router
from app.large_data.routes import clients, LargeDataBodyLimit


def fq(name=b"read", mate=1, seq=b"ACGTN", quality=b"IIIII", suffix=True):
    return b"@" + name + (b"/" + str(mate).encode() if suffix else b"") + b"\n" + seq + b"\n+\n" + quality + b"\n"


def row(data, fmt="fastq"):
    return dict(id=str(uuid4()), expected_bytes=len(data), expected_sha256=hashlib.sha256(data).hexdigest(), data_format=fmt, object_etag='"etag"')


def paired(a=None, b=None, formats=("fastq", "fastq"), **kw):
    a = fq() if a is None else a
    b = fq(mate=2) if b is None else b
    streams = [io.BytesIO(a), io.BytesIO(b)]
    try:
        return verify_pair(streams, [row(a, formats[0]), row(b, formats[1])], 1024**3, **kw)
    finally:
        assert all(s.closed for s in streams)


def test_hand_counted_comparison_and_no_raw_identifiers():
    a = fq(b"PRIVATE_ID", 1) + fq(b"other", 1, b"GC", b"55")
    b = fq(b"PRIVATE_ID", 2, b"ATNN", b"!!!!") + fq(b"other", 2, b"ACGT", b"5555")
    out = paired(a, b)
    assert out["pair_count"] == out["explicit_mate_labels"] == 2
    assert out["source_sha256"] == [hashlib.sha256(a).hexdigest(), hashlib.sha256(b).hexdigest()]
    assert out["source_bytes"] == [len(a), len(b)]
    assert out["mates"][0]["base_count"] == 7
    assert out["mates"][0]["q30_bases"] == 5
    assert out["mates"][0]["q20_bases"] == 7
    assert out["mates"][1]["q20_bases"] == 4
    assert out["mates"][0]["gc_percent"] == pytest.approx(4 / 6 * 100)
    assert out["sampling"] is False
    assert out["biological_pairing_proven"] is False
    assert out["unique_identifiers_checked"] is False
    assert b"PRIVATE_ID" not in repr(out).encode()
    assert "object_key" not in out


@pytest.mark.parametrize("header,expected", [
    (b"@read/1", (b"read", 1)), (b"@read/2", (b"read", 2)),
    (b"@cluster 1:N:0:ATCG", (b"cluster", 1)), (b"@cluster 2:Y:18:ATCG", (b"cluster", 2)),
    (b"@cluster/1  1:N:0:", (b"cluster", 1)),
    (b"@SRR100.1 note", (b"SRR100.1", None)), (b"@cluster other annotation", (b"cluster", None)),
])
def test_identifier_normalization(header, expected):
    assert mate_identifier(header) == expected


@pytest.mark.parametrize("header", [b"@/1", b"@ ", b"@ cluster", b"@x\t1:N:0:AA", b"@x\x7f", b"x/1", b"@x 1:bad", b"@x/1 2:N:0:A"])
def test_no_ambiguous_or_conflicting_identifier_silently_accepted(header):
    with pytest.raises(LargeDataError): mate_identifier(header)


def test_unmarked_and_partial_labels_are_not_mate_orientation_proof():
    out = paired(fq(suffix=False), fq(mate=2, suffix=False))
    assert out["unlabeled_pairs"] == 1 and out["explicit_mate_labels"] == 0
    assert out["identical_source_hashes"] is True
    out = paired(fq(), fq(mate=2, suffix=False))
    assert out["partially_labeled_pairs"] == 1


@pytest.mark.parametrize("a,b,code", [
    (fq(), fq(b"wrong", 2), "pair_identifier_mismatch"),
    (fq(), fq(), "pair_orientation_mismatch"),
    (fq(mate=2), fq(), "pair_orientation_mismatch"),
    (fq(), fq(mate=2) + fq(mate=2), "pair_count_mismatch"),
    (fq() + fq(), fq(mate=2), "pair_count_mismatch"),
    (fq(b"a") + fq(b"b"), fq(b"b", 2) + fq(b"a", 2), "pair_identifier_mismatch"),
])
def test_invalid_pairs_fail_closed_without_partial_metrics(a, b, code):
    with pytest.raises(LargeDataError) as e: paired(a, b)
    assert e.value.code == code


def test_gzip_mixed_sources_concatenated_members_and_no_final_lf():
    a = fq(b"a") + fq(b"b")
    b = gzip.compress(fq(b"a", 2)) + gzip.compress(fq(b"b", 2).rstrip(b"\n"))
    result = paired(a, b, formats=("fastq", "fastq.gz"))
    assert result["pair_count"] == 2
    assert result["mates"][1]["expanded_bytes"] == len(fq(b"a", 2) + fq(b"b", 2)) - 1


@pytest.mark.parametrize("payload", [b"not gzip", gzip.compress(fq())[:-4], b"\x1f\x8b\x08" + b"\0"*7 + b"invalid"])
def test_bad_compressed_mate_and_crc_fail(payload):
    with pytest.raises(LargeDataError) as e: paired(payload, formats=("fastq.gz", "fastq"))
    assert e.value.code in {"format_invalid", "pair_orientation_mismatch"}


def test_both_hashes_must_match_and_sources_close():
    streams = [io.BytesIO(fq()), io.BytesIO(fq(mate=2))]
    rows = [row(fq()), row(fq(mate=2))]
    rows[1]["expected_sha256"] = "f"*64
    with pytest.raises(LargeDataError) as e: verify_pair(streams, rows, 1024**2)
    assert e.value.code == "checksum_mismatch" and all(s.closed for s in streams)


@pytest.mark.parametrize("kw", [{"cancelled": lambda: True}, {"max_seconds": -1}])
def test_cancellation_and_timeout(kw):
    with pytest.raises(LargeDataError) as e: paired(**kw)
    assert e.value.code in {"lease_lost", "resource_limit"}


def test_expansion_limits_and_truncated_transfers():
    a, b = fq(), fq(mate=2)
    streams = [io.BytesIO(a), io.BytesIO(b)]
    with pytest.raises(LargeDataError) as e: verify_pair(streams, [row(a), row(b)], len(a)-1)
    assert e.value.code == "resource_limit"
    rows = [row(a), row(b)]; rows[1]["expected_bytes"] += 1
    with pytest.raises(LargeDataError) as e: verify_pair([io.BytesIO(a), io.BytesIO(b)], rows, 1000)
    assert e.value.code == "transfer_error"


def test_empty_and_opaque_rejected():
    with pytest.raises(LargeDataError): paired(b"", b"")
    with pytest.raises(LargeDataError): paired(formats=("opaque", "fastq"))


def test_seeded_reference_aggregate_equivalence():
    rng = random.Random(450045)
    for case in range(150):
        inputs, expected = [], []
        n = rng.randrange(1, 30)
        for mate in [1, 2]:
            data = bytearray(); sequences = []; qualities = []
            for k in range(n):
                length = rng.randrange(1, 200)
                seq = bytes(rng.choices(b"ACGTN", k=length)); q = [rng.randrange(0, 61) for _ in range(length)]
                data.extend(fq(str(k).encode(), mate, seq, bytes(x+33 for x in q)))
                sequences.append(seq); qualities += q
            expected.append((b"".join(sequences), qualities))
            inputs.append(bytes(data))
        formats = ("fastq", "fastq.gz") if case % 2 else ("fastq.gz", "fastq.gz")
        for i, fmt in enumerate(formats):
            if fmt == "fastq.gz": inputs[i] = gzip.compress(inputs[i], mtime=0)
        out = paired(*inputs, formats=formats)
        assert out["pair_count"] == n
        for actual, (bases, quality) in zip(out["mates"], expected):
            assert actual["base_count"] == len(bases)
            assert actual["base_counts"] == {chr(x): bases.count(x) for x in b"ACGTN"}
            assert actual["q20_bases"] == sum(q>=20 for q in quality)
            assert actual["q30_bases"] == sum(q>=30 for q in quality)
            assert actual["mean_phred"] == pytest.approx(sum(quality)/len(quality))


def test_bounded_reads_for_large_single_record():
    class Bound(io.BytesIO):
        def read(self, size=-1):
            assert 0 < size <= 1024**2
            return super().read(size)
    seq = b"A" * (1024**2); qual = b"I"*len(seq)
    a, b = fq(seq=seq, quality=qual), fq(mate=2, seq=seq, quality=qual)
    out = verify_pair([Bound(a), Bound(b)], [row(a), row(b)], 10*1024**2)
    assert out["pair_count"] == 1


def test_worker_source_change_and_setup_failure_never_publish_success():
    a, b = fq(), fq(mate=2)
    rows = [row(a), row(b)]
    job = dict(id=str(uuid4()), operation_token=str(uuid4()), sources=rows)
    c = SimpleNamespace(storage=Mock(), rpc=Mock())
    c.storage.config = SimpleNamespace(identity="x", max_expanded_bytes=1000)
    c.rpc.side_effect = lambda name, **kw: job if name == "pair_claim" else True
    source = io.BytesIO(a)
    c.storage.head.return_value = {"etag": '"etag"', "size": len(a)}
    c.storage.open.side_effect = [source, OSError("not logged private path")]
    assert process_pair(c, "worker")
    assert source.closed
    assert c.rpc.call_args.kwargs["p_error"] == "transfer_error"
    assert c.rpc.call_args.kwargs["p_summary"] is None


def test_worker_cancel_does_not_publish():
    stop = threading.Event(); stop.set()
    c = Mock()
    assert process_pair(c, "worker", stop) is False
    c.rpc.assert_not_called()


def test_route_gate_and_field_redaction(monkeypatch):
    app = FastAPI(); app.include_router(router); app.add_middleware(LargeDataBodyLimit)
    fake = SimpleNamespace(auth=lambda _: "owner", rpc=lambda *_, **__: {
        "id": "public", "operation_token": "SECRET", "object_key": "PRIVATE", "title": "Research"})
    app.dependency_overrides[clients] = lambda: fake
    api = TestClient(app); pid = str(uuid4())
    monkeypatch.delenv("GENITHM_LARGE_DATA_PAIRING_ENABLED", raising=False)
    assert api.get('/api/v1/large-data/pairs/'+pid).status_code == 503
    monkeypatch.setenv("GENITHM_LARGE_DATA_PAIRING_ENABLED", "true")
    r = api.get('/api/v1/large-data/pairs/'+pid)
    assert r.status_code == 200 and "SECRET" not in r.text and "PRIVATE" not in r.text
    assert api.post('/api/v1/large-data/pairs', json={}).status_code == 422
    body = dict(project_id=pid, request_id=pid, r1_id=pid, r2_id=pid, title="Research")
    assert api.post('/api/v1/large-data/pairs', json={**body, 'source_sha256':'a'*64}).status_code == 422
    assert api.post('/api/v1/large-data/pairs', json={**body, 'title':'bad\nname'}).status_code == 422
