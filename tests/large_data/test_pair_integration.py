"""Real PostgreSQL+S3 paired execution, never production datasets or credentials."""
from __future__ import annotations
import concurrent.futures
import gzip
import hashlib
from uuid import uuid4
import pytest
import psycopg
from conftest import connect
from test_integration import reserve, put, age_links
from app.large_data.worker import process_one
from app.large_data.pair_worker import process_pair
from app.large_data.policy import LargeDataError


@pytest.fixture
def pe(env, monkeypatch):
    monkeypatch.setenv('GENITHM_LARGE_DATA_PAIRING_ENABLED','true')
    env['c'].rpc('pair_heartbeat',p_worker=str(uuid4()),p_storage=env['c'].storage.config.identity)
    return env


def ready_file(e, data, fmt='fastq'):
    e['c'].rpc('heartbeat',p_worker=str(uuid4()),p_storage=e['c'].storage.config.identity)
    r=reserve(e,data,fmt=fmt); assert r.status_code==201,r.text
    uid=r.json()['id'];put(e,uid,1,data)
    assert e['api'].post(f'/api/v1/large-data/uploads/{uid}/complete',json={},headers=e['headers']).status_code==200
    assert process_one(e['c'],str(uuid4()))
    result=e['api'].get(f'/api/v1/large-data/uploads/{uid}',headers=e['headers']).json()
    assert result['state']=='ready',result
    return uid


def enqueue(e, a, b, request=None, title='Paired research'):
    return e['api'].post('/api/v1/large-data/pairs',headers=e['headers'],json={
        'project_id':e['project'],'request_id':request or str(uuid4()),'r1_id':a,'r2_id':b,'title':title})


def sources(e, a=b'@x/1\nACGTN\n+\nIIIII\n', b=b'@x/2\nGC\n+\n55\n'):
    return ready_file(e,a),ready_file(e,b)


def get(e, pid, token='owner-token'):
    return e['api'].get('/api/v1/large-data/pairs/'+pid,headers={'Authorization':'Bearer '+token})


def test_pair_execution_through_actual_router_sql_s3(pe):
    e=pe;a=ready_file(e,b'@x 1:N:0:ATCG\nACGTN\n+\nIIIII\n');b=ready_file(e,gzip.compress(b'@x 2:N:0:ATCG\nGC\n+\n55\n'),fmt='fastq.gz')
    r=enqueue(e,a,b);assert r.status_code==201,r.text
    pid=r.json()['id']; assert r.json()['state']=='queued'
    assert 'operation_token' not in r.json() and 'storage_identity' not in r.json()
    assert process_pair(e['c'],str(uuid4()))
    out=get(e,pid).json();assert out['state']=='ready',out
    s=out['summary'];assert s['pair_count']==1 and s['explicit_mate_labels']==1
    assert s['mates'][0]['q30_bases']==5 and s['mates'][1]['q30_bases']==0
    assert s['source_ids']==[a,b] and out['sources_available']
    assert 'ATCG' not in str(s)  # Barcode/read headers are never exposed.
    overview=e['api'].get('/api/v1/large-data/projects/'+e['project']+'/pairs',headers=e['headers']).json()
    assert overview['worker_ready'] and len(overview['pairs'])==1
    assert 'operation_token' not in overview['pairs'][0]
    age_links(a)
    assert e['api'].post('/api/v1/large-data/uploads/'+a+'/abort',json={},headers=e['headers']).status_code==200
    historical=get(e,pid).json()
    assert historical['state']=='ready' and historical['sources_available'] is False


@pytest.mark.parametrize('mate,error',[
    (b'@wrong/2\nGC\n+\nII\n','pair_identifier_mismatch'),
    (b'@x/1\nGC\n+\nII\n','pair_orientation_mismatch'),
    (b'@x/2\nGC\n+\nII\n@x/2\nGC\n+\nII\n','pair_count_mismatch'),
])
def test_rejected_pair_has_no_partial_success(pe,mate,error):
    e=pe;a,b=sources(e,b=b'@x/2\nGC\n+\nII\n' if mate is None else mate)
    r=enqueue(e,a,b);assert r.status_code==201,r.text
    pid=r.json()['id'];process_pair(e['c'],str(uuid4()))
    out=get(e,pid).json();assert out['state']=='rejected' and out['error_code']==error and out['summary'] is None


def test_owner_role_scope_and_no_direct_client_rpc(pe):
    e=pe;a,b=sources(e);pid=enqueue(e,a,b).json()['id']
    for token in ['other-token','viewer-token','outsider-token']:
        assert get(e,pid,token).status_code==404
        h={'Authorization':'Bearer '+token}
        assert e['api'].post('/api/v1/large-data/pairs/'+pid+'/cancel',json={},headers=h).status_code==404
        assert e['api'].post('/api/v1/large-data/pairs',headers=h,json={'project_id':e['project'],'request_id':str(uuid4()),'r1_id':a,'r2_id':b,'title':'Private pair'}).status_code==404
    assert get(e,pid,'forged-token').status_code==401
    with connect() as db:
        db.execute('set role authenticated')
        with pytest.raises(psycopg.errors.InsufficientPrivilege):db.execute('select public.large_data_pair_get(%s,%s)',[e['owner'],pid])
        with pytest.raises(psycopg.errors.InsufficientPrivilege):db.execute('select * from public.large_data_pairs')
        db.execute('set role anon')
        with pytest.raises(psycopg.errors.InsufficientPrivilege):db.execute('select public.large_data_pair_cancel(%s,%s)',[e['owner'],pid])


def test_cancellation_fences_worker_and_releases_source_cleanup(pe):
    e=pe;a,b=sources(e);pid=enqueue(e,a,b).json()['id'];age_links(a)
    assert e['api'].post('/api/v1/large-data/uploads/'+a+'/abort',json={},headers=e['headers']).status_code==409
    claimed=e['c'].rpc('pair_claim',p_worker=str(uuid4()),p_storage=e['c'].storage.config.identity)
    assert claimed['id']==pid
    r=e['api'].post('/api/v1/large-data/pairs/'+pid+'/cancel',json={},headers=e['headers']);assert r.json()['state']=='cancelled'
    assert e['c'].rpc('pair_progress',p_id=pid,p_token=claimed['operation_token'],p_bytes=0,p_pairs=0) is False
    assert e['c'].rpc('pair_finish',p_id=pid,p_token=claimed['operation_token'],p_summary={},p_error=None) is False
    assert e['api'].post('/api/v1/large-data/uploads/'+a+'/abort',json={},headers=e['headers']).status_code==200
    assert get(e,pid).json()['summary'] is None


def test_concurrent_idempotency_and_bounded_queue(pe):
    e=pe;a,b=sources(e);request=str(uuid4())
    def call(_):
        return e['c'].rpc('pair_enqueue',p_owner=e['owner'],p_project=e['project'],p_request=request,
            p_title='Duplicate-safe',p_r1=a,p_r2=b,p_storage=e['c'].storage.config.identity)
    with concurrent.futures.ThreadPoolExecutor(6) as pool: results=list(pool.map(call,range(6)))
    assert len({r['id'] for r in results})==1
    assert enqueue(e,a,b,request,title='Changed title').status_code==409
    assert enqueue(e,a,b).status_code==201
    assert enqueue(e,a,b).status_code==429
    with connect() as db:
        size=db.execute('select sum(expected_bytes) from public.large_data_uploads where project_id=%s',[e['project']]).fetchone()[0]
        charged=db.execute('select charged_bytes from public.large_data_project_limits where project_id=%s',[e['project']]).fetchone()[0]
    assert size==charged  # Pairing reserves execution, not a second copy of stored sources.


def test_two_workers_fencing_and_expiry_reclaim(pe):
    e=pe;a,b=sources(e);pid=enqueue(e,a,b).json()['id']
    with concurrent.futures.ThreadPoolExecutor(2) as pool:
        jobs=list(pool.map(lambda _:e['c'].rpc('pair_claim',p_worker=str(uuid4()),p_storage=e['c'].storage.config.identity),range(2)))
    assert len([j for j in jobs if j])==1
    old=next(j for j in jobs if j)
    with connect() as db:db.execute("update public.large_data_pairs set lease_until=now()-interval '1 minute' where id=%s",[pid])
    assert e['c'].rpc('pair_finish',p_id=pid,p_token=old['operation_token'],p_summary={},p_error=None) is False
    assert process_pair(e['c'],str(uuid4()))
    assert get(e,pid).json()['state']=='ready'


def test_source_corruption_refuses_success(pe):
    e=pe;a,b=sources(e);pid=enqueue(e,a,b).json()['id']
    source=e['c'].rpc('get',p_owner=e['owner'],p_id=a)
    target=e['c'].storage._target(source)
    e['c'].storage.client.put_object(**target,Body=b'@x/1\nTCGTN\n+\nIIIII\n',Metadata={'genithm-upload':a,'source-sha256':source['expected_sha256']})
    assert process_pair(e['c'],str(uuid4()))
    assert get(e,pid).json()['state']=='rejected' and get(e,pid).json()['error_code']=='source_changed'


def test_revoked_membership_cannot_keep_or_publish_lease(pe):
    e=pe;a,b=sources(e);pid=enqueue(e,a,b).json()['id']
    job=e['c'].rpc('pair_claim',p_worker=str(uuid4()),p_storage=e['c'].storage.config.identity)
    with connect() as db:db.execute('delete from public.organization_members where user_id=%s and organization_id=%s',[e['owner'],e['org']])
    assert get(e,pid).status_code==404
    assert e['c'].rpc('pair_progress',p_id=pid,p_token=job['operation_token'],p_bytes=0,p_pairs=0) is False
    assert e['c'].rpc('pair_finish',p_id=pid,p_token=job['operation_token'],p_summary={},p_error=None) is False


def test_offline_worker_and_nonfastq_sources_rejected(pe):
    e=pe;a,b=sources(e)
    assert enqueue(e,a,a).status_code==409
    other=ready_file(e,b'opaque data',fmt='opaque')
    assert enqueue(e,a,other).status_code==409
    with connect() as db:db.execute("update public.large_data_pair_workers set last_seen=now()-interval '1 hour' where storage_identity=%s",[e['c'].storage.config.identity])
    assert enqueue(e,a,b).status_code==503
