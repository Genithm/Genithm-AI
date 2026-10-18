"""Real PostgreSQL/S3 paired dataset tests. Uses only the loopback-isolated fixtures."""
import concurrent.futures
import gzip
import hashlib
from uuid import uuid4

import pytest
import psycopg
from conftest import connect
from test_integration import reserve, put, age_links
from app.large_data.worker import process_one
from app.large_data.paired_worker import process_pair
from app.large_data.paired_routes import router as paired_router
from app.large_data.paired_verify import result_digest
from app.large_data.policy import LargeDataError


@pytest.fixture
def paired(env, monkeypatch):
    monkeypatch.setenv('GENITHM_LARGE_DATA_PAIRS_ENABLED', 'true')
    env['api'].app.include_router(paired_router)
    env['c'].rpc('pair_heartbeat', p_worker=str(uuid4()), p_storage=env['c'].storage.config.identity)
    return env


def uploaded(e, data, fmt='fastq'):
    res = reserve(e, data, fmt=fmt)
    assert res.status_code == 201, res.text
    sid = res.json()['id']; put(e, sid, 1, data)
    response = e['api'].post('/api/v1/large-data/uploads/'+sid+'/complete', json={}, headers=e['headers'])
    assert response.status_code == 200, response.text
    assert process_one(e['c'], str(uuid4()))
    assert e['api'].get('/api/v1/large-data/uploads/'+sid, headers=e['headers']).json()['state'] == 'ready'
    return sid


def sources(e, a=b'@alpha/1\nACGT\n+\nIIII\n', b=b'@alpha/2\nTGCA\n+\n5555\n'):
    return uploaded(e, a), uploaded(e, b)


def submit(e, ids, request=None, headers=None):
    return e['api'].post('/api/v1/large-data/pairs', json=dict(project_id=e['project'], request_id=request or str(uuid4()),
                        read1_id=ids[0], read2_id=ids[1], title='Paired study'), headers=headers or e['headers'])


def status(e, sid):
    return e['api'].get('/api/v1/large-data/pairs/'+sid, headers=e['headers'])


def test_complete_paired_job_export_and_source_evidence(paired):
    e = paired; ids = sources(e); req = str(uuid4())
    a = submit(e, ids, req); b = submit(e, ids, req)
    assert a.status_code == b.status_code == 202, a.text
    assert a.json()['id'] == b.json()['id'] and a.json()['state'] == 'queued' and a.json()['result'] is None
    sid = a.json()['id']
    assert not {'object_key', 'operation_token', 'storage_identity', 'read1_etag'} & a.json().keys()
    assert e['api'].get('/api/v1/large-data/pairs/'+sid+'/report', headers=e['headers']).status_code == 409
    assert process_pair(e['c'], str(uuid4()))
    row = status(e, sid).json(); assert row['state'] == 'ready', row
    result = row['result']
    assert result['matched_pairs'] == 1 and result['both_mate_annotations_checked'] == 1
    assert result['r1']['metrics']['q30_bases'] == 4 and result['r2']['metrics']['q30_bases'] == 0
    assert result_digest(result) == row['result_sha256']
    exported = e['api'].get('/api/v1/large-data/pairs/'+sid+'/report', headers=e['headers'])
    assert exported.status_code == 200 and 'no-store' in exported.headers['cache-control']
    assert row['read1_sha256'] in exported.text and row['result_sha256'] in exported.text
    assert 'alpha' not in exported.text and 'TGCA' not in exported.text
    with connect() as db:
        db.execute("update public.large_data_pairs set result=jsonb_set(result,'{matched_pairs}','9') where id=%s", [sid])
    assert status(e, sid).status_code == 409
    assert e['api'].get('/api/v1/large-data/pairs/'+sid+'/report', headers=e['headers']).status_code == 409


@pytest.mark.parametrize('bad,code', [(b'@other/2\nA\n+\nI\n', 'pair_identifier_mismatch'),
    (b'@alpha/2\nA\n+\nI\n@extra/2\nA\n+\nI\n', 'pair_count_mismatch'),
    (b'@alpha/1\nA\n+\nI\n', 'mate_orientation_mismatch')])
def test_scientific_pair_mismatch_never_publishes_partial_result(paired, bad, code):
    e = paired; ids = sources(e, b=bad); sid = submit(e, ids).json()['id']
    process_pair(e['c'], str(uuid4())); row = status(e, sid).json()
    assert row['state'] == 'rejected' and row['error_code'] == code
    assert row['result'] is None and row['result_sha256'] is None


def test_actual_gzip_pair_streams(paired):
    e = paired
    ids = (uploaded(e, gzip.compress(b'@cluster 1:N:0:ACGT\nACGT\n+\nIIII\n'), 'fastq.gz'),
           uploaded(e, gzip.compress(b'@cluster 2:N:0:ACGT\nTGCA\n+\nIIII\n'), 'fastq.gz'))
    sid = submit(e, ids).json()['id']; assert process_pair(e['c'], str(uuid4()))
    assert status(e, sid).json()['result']['both_mate_annotations_checked'] == 1


def test_pair_owner_viewer_and_direct_sql_denied(paired):
    e = paired; ids = sources(e); sid = submit(e, ids).json()['id']
    for token in ('other-token', 'viewer-token', 'outsider-token'):
        h = {'Authorization': 'Bearer '+token}
        assert e['api'].get('/api/v1/large-data/pairs/'+sid, headers=h).status_code == 404
        assert e['api'].post('/api/v1/large-data/pairs/'+sid+'/cancel', headers=h, json={}).status_code == 404
        assert e['api'].get('/api/v1/large-data/pairs/'+sid+'/report', headers=h).status_code == 404
        assert submit(e, ids, headers=h).status_code in (404, 409)
    assert submit(e, ids, headers={'Authorization': 'Bearer forged'}).status_code == 401
    assert submit(e, (ids[0], ids[0])).status_code == 422
    with connect() as db:
        db.execute('set role authenticated')
        with pytest.raises(psycopg.errors.InsufficientPrivilege): db.execute('select * from public.large_data_pairs')
        with pytest.raises(psycopg.errors.InsufficientPrivilege): db.execute('select public.large_data_pair_get(%s,%s)', [e['owner'], sid])
        db.execute('set role anon')
        with pytest.raises(psycopg.errors.InsufficientPrivilege): db.execute('select * from public.large_data_pair_workers')


def test_source_removal_blocked_until_cancel_and_stale_worker_fenced(paired):
    e = paired; ids = sources(e); sid = submit(e, ids).json()['id']
    claim = e['c'].rpc('pair_claim', p_worker=str(uuid4()), p_storage=e['c'].storage.config.identity)
    for source in ids:
        age_links(source)
        res = e['api'].post('/api/v1/large-data/uploads/'+source+'/abort', json={}, headers=e['headers'])
        assert res.status_code == 409 and 'source_in_active_pair' in res.text
    assert e['api'].post('/api/v1/large-data/pairs/'+sid+'/cancel', json={}, headers=e['headers']).json()['state'] == 'cancelled'
    assert e['c'].rpc('pair_progress', p_id=sid, p_token=claim['job']['operation_token'], p_read1_bytes=0, p_read2_bytes=0) is False
    assert e['c'].rpc('pair_finish', p_id=sid, p_token=claim['job']['operation_token'], p_result={}, p_sha256='a'*64, p_error=None) is False
    for source in ids:
        assert e['api'].post('/api/v1/large-data/uploads/'+source+'/abort', json={}, headers=e['headers']).json()['state'] == 'aborted'


def test_pair_queue_limits_and_exclusive_claim(paired):
    e = paired; ids = sources(e)
    assert submit(e, ids).status_code == 202; assert submit(e, ids).status_code == 202
    assert submit(e, ids).status_code == 429
    with concurrent.futures.ThreadPoolExecutor(3) as pool:
        got = list(pool.map(lambda _: e['c'].rpc('pair_claim', p_worker=str(uuid4()), p_storage=e['c'].storage.config.identity), range(3)))
    jobs = [x['job']['id'] for x in got if x]
    assert len(jobs) == len(set(jobs)) == 2


def test_expiry_reclaim_revocation_and_hashes_not_browser_supplied(paired):
    e = paired; ids = sources(e); sid = submit(e, ids).json()['id']
    first = e['c'].rpc('pair_claim', p_worker=str(uuid4()), p_storage=e['c'].storage.config.identity)['job']
    with connect() as db: db.execute("update public.large_data_pairs set lease_until=now()-interval '1 minute' where id=%s", [sid])
    second = e['c'].rpc('pair_claim', p_worker=str(uuid4()), p_storage=e['c'].storage.config.identity)['job']
    assert first['operation_token'] != second['operation_token']
    assert e['c'].rpc('pair_progress', p_id=sid, p_token=first['operation_token'], p_read1_bytes=0, p_read2_bytes=0) is False
    with connect() as db: db.execute('delete from public.organization_members where user_id=%s and organization_id=%s', [e['owner'], e['org']])
    assert e['c'].rpc('pair_progress', p_id=sid, p_token=second['operation_token'], p_read1_bytes=0, p_read2_bytes=0) is False
    assert e['c'].rpc('pair_finish', p_id=sid, p_token=second['operation_token'], p_result={}, p_sha256='a'*64, p_error=None) is False
    with connect() as db: assert db.execute('select state,result from public.large_data_pairs where id=%s', [sid]).fetchone() == ('cancelled', None)


def test_pair_refuses_offline_worker_unready_source_and_changed_storage(paired):
    e = paired; ids = sources(e)
    with connect() as db: db.execute("update public.large_data_pair_workers set last_seen=now()-interval '5 minutes' where storage_identity=%s", [e['c'].storage.config.identity])
    assert submit(e, ids).status_code == 503
    e['c'].rpc('pair_heartbeat', p_worker=str(uuid4()), p_storage=e['c'].storage.config.identity)
    sid = submit(e, ids).json()['id']
    original = e['c'].storage.head
    e['c'].storage.head = lambda row: dict(size=row['expected_bytes'], etag='"replaced"')
    try: assert process_pair(e['c'], str(uuid4()))
    finally: e['c'].storage.head = original
    assert status(e, sid).json()['error_code'] == 'source_changed'
