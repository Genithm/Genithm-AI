from __future__ import annotations
import gzip
import hashlib
import io
import json
import random
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.large_data.policy import LargeDataError
from app.large_data.paired_verify import verify_pair, result_digest, identity
from app.large_data.paired_worker import process_pair
from app.large_data.paired_routes import router, paired_clients, validate_result, report_tsv
from app.large_data.routes import LargeDataBodyLimit

R1 = b'@alpha/1\nACGTN\n+\nIIIII\n@beta/1\nGCAA\n+\n5555\n'
R2 = b'@alpha/2\nTTTT\n+\nIIII\n@beta/2\nCCCC\n+\n####\n'


def source_row(data, fmt='fastq'):
    return dict(id=str(uuid4()), expected_bytes=len(data), expected_sha256=hashlib.sha256(data).hexdigest(),
                data_format=fmt, object_etag='"opaque-etag"')


class Bounded(io.BytesIO):
    largest = 0
    def read(self, size=-1):
        assert 0 <= size <= 1024**2
        self.largest = max(self.largest, size)
        return super().read(size)


def check(a=R1, b=R2, formats=('fastq', 'fastq'), **options):
    streams = [Bounded(a), Bounded(b)]
    rows = [source_row(x, f) for x, f in zip((a, b), formats)]
    try:
        return verify_pair(streams, rows, 1024**2, **options)
    finally:
        assert all(stream.closed for stream in streams)


@pytest.mark.parametrize('compressed', [False, True])
def test_hand_calculated_all_records_and_full_sha(compressed):
    data = [gzip.compress(x, mtime=0) if compressed else x for x in (R1, R2)]
    result, digest = check(*data, formats=('fastq.gz', 'fastq.gz') if compressed else ('fastq', 'fastq'))
    assert result['matched_pairs'] == result['both_mate_annotations_checked'] == 2
    assert result['identifier_order_only_pairs'] == 0
    a, b = result['r1']['metrics'], result['r2']['metrics']
    assert a['base_count'] == 9 and a['base_counts'] == dict(A=3, C=2, G=2, T=1, N=1)
    assert a['q20_bases'] == 9 and a['q30_bases'] == 5 and a['mean_phred'] == pytest.approx(280/9)
    assert b['base_count'] == 8 and b['mean_phred'] == 21 and b['q30_bases'] == 4
    assert a['gc_percent'] == b['gc_percent'] == 50
    assert result['sampling'] is False and result['identifier_uniqueness_checked'] is False
    assert digest == result_digest(result)
    for i, d in enumerate(data, 1):
        assert result[f'r{i}']['sha256'] == hashlib.sha256(d).hexdigest()
    assert all(secret not in json.dumps(result) for secret in ('alpha', 'beta', 'ACGTN', 'IIIII'))


def test_plain_ids_are_not_claimed_as_explicit_mate_annotations():
    a, b = R1.replace(b'/1', b''), R2.replace(b'/2', b'')
    result, _ = check(a, b)
    assert result['identifier_order_only_pairs'] == 2 and result['both_mate_annotations_checked'] == 0


def test_casava_annotations_and_mixed_compression():
    a = R1.replace(b'/1', b' 1:N:0:ATGC')
    b = R2.replace(b'/2', b' 2:N:0:ATGC')
    result, _ = check(gzip.compress(a), b, formats=('fastq.gz', 'fastq'))
    assert result['both_mate_annotations_checked'] == 2
    assert identity(b'@cluster/1 1:N:0:ACGT') == (b'cluster', 1)


@pytest.mark.parametrize('a,b,code', [
    (R1, R2.replace(b'alpha', b'wrong'), 'pair_identifier_mismatch'),
    (R1, b'@alpha/2\nA\n+\nI\n', 'pair_count_mismatch'),
    (R1, R1, 'mate_orientation_mismatch'),
    (R2, R1, 'mate_orientation_mismatch'),
    (R1.replace(b'/1', b'/1 2:N:0:ACGT'), R2, 'mate_orientation_mismatch'),
    (R1.replace(b'@alpha/1', b'@alpha/1 1:bad'), R2, 'format_invalid'),
    (R1.replace(b'@alpha', b'@ alpha'), R2, 'format_invalid'),
    (R1.replace(b'@alpha', b'@\x7falpha'), R2, 'format_invalid'),
    (R1.replace(b'ACGTN', b'ACGTX'), R2, 'format_invalid'),
    (R1.replace(b'IIIII', b'IIII'), R2, 'format_invalid'),
    (R1.replace(b'\n+\n', b'\n+wrong\n'), R2, 'format_invalid'),
    (b'', b'', 'format_invalid'),
])
def test_invalid_pair_never_publishes_partial_metrics(a, b, code):
    with pytest.raises(LargeDataError, match=code):
        check(a, b)


def test_concatenated_gzip_and_final_records_without_newline():
    a = gzip.compress(R1[:R1.index(b'@beta')]) + gzip.compress(R1[R1.index(b'@beta'):].rstrip(b'\n'))
    result, _ = check(a, R2.rstrip(b'\n'), formats=('fastq.gz', 'fastq'))
    assert result['matched_pairs'] == 2


@pytest.mark.parametrize('issue', ['crc', 'truncated', 'size', 'sha', 'decompression', 'cancel', 'timeout'])
def test_failing_streams_are_closed_and_not_successful(issue):
    a = gzip.compress(R1, mtime=0)
    if issue == 'crc':
        a = a[:-8] + bytes([a[-8] ^ 1]) + a[-7:]
    if issue == 'truncated':
        a = a[:-5]
    rows = [source_row(a, 'fastq.gz'), source_row(R2)]
    if issue == 'size': rows[1]['expected_bytes'] += 1
    if issue == 'sha': rows[1]['expected_sha256'] = '0'*64
    streams = [Bounded(a), Bounded(R2)]
    kwargs = {'cancelled': lambda: True} if issue == 'cancel' else {'max_seconds': -1} if issue == 'timeout' else {}
    with pytest.raises(LargeDataError):
        verify_pair(streams, rows, 3 if issue == 'decompression' else 10000, **kwargs)
    assert all(s.closed for s in streams)


def test_150_seeded_pairs_against_independent_reference_arithmetic():
    rng = random.Random(45)
    for case in range(150):
        reads = [[], []]
        for i in range(rng.randint(1, 16)):
            for mate in (0, 1):
                bases = bytes(rng.choice(b'ACGTN') for _ in range(rng.randint(1, 180)))
                qs = bytes(rng.randint(33, 126) for _ in bases)
                reads[mate].append((bases, qs))
        documents = [b''.join(b'@read'+str(i).encode()+b'/'+str(mate+1).encode()+b'\n'+bases+b'\n+\n'+q+b'\n'
                             for i, (bases, q) in enumerate(items)) for mate, items in enumerate(reads)]
        fmts = ('fastq.gz', 'fastq') if case % 2 else ('fastq', 'fastq.gz')
        docs = [gzip.compress(d, mtime=0) if f.endswith('.gz') else d for d, f in zip(documents, fmts)]
        result, _ = check(*docs, formats=fmts)
        for mate in (0, 1):
            seq = b''.join(x[0] for x in reads[mate]); quality = b''.join(x[1] for x in reads[mate])
            actual = result[f'r{mate+1}']['metrics']
            assert actual['base_count'] == len(seq)
            assert actual['base_counts'] == {chr(x): sum(v == x for v in seq) for x in b'ACGTN'}
            assert actual['q30_bases'] == sum(x-33 >= 30 for x in quality)
            assert actual['mean_phred'] == pytest.approx(sum(x-33 for x in quality)/len(quality))


def fake_client(open_failure=False, finish_failure=False):
    rows = [source_row(R1), source_row(R2)]
    job = dict(id=str(uuid4()), project_id=str(uuid4()), title='=unsafe spreadsheet title', operation_token=str(uuid4()), state='running')
    for i, row in enumerate(rows, 1):
        for field, key in [('id', 'id'), ('sha256', 'expected_sha256'), ('bytes', 'expected_bytes'), ('etag', 'object_etag')]:
            job[f'read{i}_{field}'] = row[key]
    streams = [Bounded(R1), Bounded(R2)]; calls = []
    def opened(row):
        if row == rows[1] and open_failure: raise OSError('private storage locator not returned')
        return streams[rows.index(row)]
    def rpc(name, **kw):
        calls.append((name, kw))
        if name == 'pair_claim': return dict(job=job, r1=rows[0], r2=rows[1])
        if name == 'pair_finish' and finish_failure: raise TimeoutError('commit outcome unknown')
        return True
    c = SimpleNamespace(rpc=rpc, storage=SimpleNamespace(config=SimpleNamespace(identity='f'*64, max_expanded_bytes=10000),
         head=lambda row: dict(size=row['expected_bytes'], etag=row['object_etag']), open=opened))
    return c, calls, streams, job


def test_real_worker_success_report_checksum_and_no_secret_fields():
    c, calls, streams, job = fake_client()
    assert process_pair(c, str(uuid4()))
    finishes = [kw for name, kw in calls if name == 'pair_finish']
    assert len(finishes) == 1 and finishes[0]['p_error'] is None
    assert all(s.closed for s in streams)
    row = {**job, 'state': 'ready', 'result': finishes[0]['p_result'], 'result_sha256': finishes[0]['p_sha256']}
    validate_result(row)
    tsv = report_tsv(row)
    assert "'=unsafe spreadsheet title" in tsv and 'Matched ordered pairs\t2' in tsv
    row['result']['matched_pairs'] = 3
    with pytest.raises(LargeDataError, match='pair_result_invalid'): validate_result(row)


def test_r2_open_failure_closes_r1_and_commit_is_not_replayed():
    c, calls, streams, _ = fake_client(open_failure=True)
    process_pair(c, str(uuid4()))
    assert streams[0].closed
    assert [kw['p_error'] for name, kw in calls if name == 'pair_finish'] == ['transfer_error']
    c, calls, _, _ = fake_client(finish_failure=True)
    with pytest.raises(TimeoutError): process_pair(c, str(uuid4()))
    assert sum(name == 'pair_finish' for name, _ in calls) == 1


def test_lease_loss_cannot_publish():
    c, calls, streams, _ = fake_client()
    old = c.rpc
    c.rpc = lambda name, **kw: False if name == 'pair_progress' else old(name, **kw)
    process_pair(c, str(uuid4()))
    assert not any(name == 'pair_finish' for name, _ in calls)
    assert all(s.closed for s in streams)


def test_api_rejects_forged_actor_and_raw_metadata():
    app = FastAPI(); app.include_router(router); app.add_middleware(LargeDataBodyLimit)
    c = SimpleNamespace(auth=lambda _: str(uuid4()))
    app.dependency_overrides[paired_clients] = lambda: c
    with TestClient(app) as api:
        r = api.post('/api/v1/large-data/pairs', json={'created_by': str(uuid4()), 'raw_reads': 'ATTACK'})
        assert r.status_code == 422
        r = api.post('/api/v1/large-data/pairs', content=b'x'*20000)
        assert r.status_code == 413
