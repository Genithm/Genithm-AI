from __future__ import annotations
import concurrent.futures
import hashlib
import json
import os
import time
from pathlib import Path
from uuid import uuid4
from urllib.request import Request,urlopen
from urllib.error import HTTPError
import pytest
import psycopg
from conftest import connect,SqlGateway
from app.large_data.policy import PART_BYTES,LargeDataError
from app.large_data.worker import process_one


def reserve(e,data=b'@x\nACGT\n+\nIIII\n',fmt='fastq',size=None,sha=None,request_id=None):
    return e['api'].post('/api/v1/large-data/uploads',headers=e['headers'],json=dict(project_id=e['project'],request_id=request_id or str(uuid4()),
      filename='research.fastq' if fmt=='fastq' else 'research.bin',data_format=fmt,expected_bytes=len(data) if size is None else size,
      expected_sha256=hashlib.sha256(data).hexdigest() if sha is None else sha))


def put(e,sid,number,data):
    r=e['api'].post(f'/api/v1/large-data/uploads/{sid}/parts/{number}',json={},headers=e['headers'])
    assert r.status_code==200,r.text
    signed=r.json()
    with urlopen(Request(signed['url'],data=data,method='PUT'),timeout=120) as resp:
        assert resp.status==200
    return signed


def age_links(sid):
    with connect() as db:db.execute("update public.large_data_uploads set signed_until=now()-interval '8 minutes' where id=%s",[sid])


def test_real_private_auth_s3_sql_verify_and_cleanup(env):
    e=env;data=b'@x\nACGT\n+\nIIII\n';r=reserve(e,data);assert r.status_code==201,r.text
    u=r.json();assert u['state']=='uploading'
    assert 'object_key' not in u and 'operation_token' not in u
    sid=u['id'];put(e,sid,1,data)
    done=e['api'].post(f'/api/v1/large-data/uploads/{sid}/complete',json={},headers=e['headers'])
    assert done.status_code==200 and done.json()['state']=='uploaded'
    assert process_one(e['c'],str(uuid4()))
    r=e['api'].get(f'/api/v1/large-data/uploads/{sid}',headers=e['headers']);result=r.json()
    assert result['state']=='ready' and result['actual_sha256']==hashlib.sha256(data).hexdigest()
    assert result['summary']['metrics']['q30_bases']==4
    with connect() as db:
        assert db.execute('select charged_bytes from public.large_data_project_limits where project_id=%s',[e['project']]).fetchone()[0]==len(data)
    assert e['api'].post(f'/api/v1/large-data/uploads/{sid}/abort',json={},headers=e['headers']).status_code==409
    age_links(sid)
    assert e['api'].post(f'/api/v1/large-data/uploads/{sid}/abort',json={},headers=e['headers']).json()['state']=='aborted'
    # Repeated cancel cannot double release quota.
    assert e['api'].post(f'/api/v1/large-data/uploads/{sid}/abort',json={},headers=e['headers']).status_code==200
    with connect() as db:assert db.execute('select charged_bytes from public.large_data_project_limits where project_id=%s',[e['project']]).fetchone()[0]==0


def test_tenant_and_viewer_access(env):
    e=env;sid=reserve(e).json()['id']
    for token in ['other-token','viewer-token','outsider-token']:
        h={'Authorization':'Bearer '+token}
        assert e['api'].get('/api/v1/large-data/uploads/'+sid,headers=h).status_code==404
        assert e['api'].post('/api/v1/large-data/uploads/'+sid+'/parts/1',json={},headers=h).status_code==404
    h={'Authorization':'Bearer viewer-token'}
    assert e['api'].post('/api/v1/large-data/uploads',headers=h,json=dict(project_id=e['project'],request_id=str(uuid4()),filename='a.fq',expected_bytes=10,expected_sha256='a'*64,data_format='fastq')).status_code==404
    assert e['api'].get('/api/v1/large-data/uploads/'+sid,headers={'Authorization':'Bearer forged'}).status_code==401
    with connect() as db:
        db.execute('set role authenticated')
        with pytest.raises(psycopg.errors.InsufficientPrivilege):db.execute('select public.large_data_get(%s,%s)',[e['owner'],sid])
        with pytest.raises(psycopg.errors.InsufficientPrivilege):db.execute("update public.large_data_uploads set state='ready' where id=%s",[sid])
        with pytest.raises(psycopg.errors.InsufficientPrivilege):db.execute('update public.large_data_project_limits set capacity_bytes=10995116277760')
        db.execute('set role anon')
        with pytest.raises(psycopg.errors.InsufficientPrivilege):db.execute('select * from public.large_data_uploads')


def test_idempotency_and_concurrent_quota_reservations(env):
    e=env;request=str(uuid4());a=reserve(e,request_id=request);b=reserve(e,request_id=request)
    assert a.json()['id']==b.json()['id']
    assert reserve(e,b'changed',request_id=request).status_code==409
    with connect() as db:
        db.execute('update public.large_data_project_limits set capacity_bytes=1000000 where project_id=%s',[e['project']])
    def attempt(_):
        try:
            return e['c'].rpc('reserve',p_owner=e['owner'],p_project=e['project'],p_request=str(uuid4()),p_filename='quota.bin',
                p_bytes=600000,p_sha256='a'*64,p_format='opaque',p_storage=e['c'].storage.config.identity)['id']
        except LargeDataError:return None
    with concurrent.futures.ThreadPoolExecutor(8) as pool:got=list(pool.map(attempt,range(8)))
    assert len([x for x in got if x])==1
    with connect() as db:assert db.execute('select charged_bytes<=capacity_bytes from public.large_data_project_limits where project_id=%s',[e['project']]).fetchone()[0]


def test_signatures_size_and_missing_parts(env):
    e=env;sid=reserve(e,size=PART_BYTES+1,sha='a'*64,fmt='opaque').json()['id']
    signed=e['api'].post(f'/api/v1/large-data/uploads/{sid}/parts/1',json={},headers=e['headers']).json()
    assert 'content-length%3Bhost' in signed['url'] or 'content-length;host' in signed['url']
    with pytest.raises(HTTPError) as error:urlopen(Request(signed['url'],data=b'wrong-size',method='PUT'))
    assert error.value.code in (400,403)
    assert e['api'].post(f'/api/v1/large-data/uploads/{sid}/parts/3',json={},headers=e['headers']).status_code==422
    assert e['api'].post(f'/api/v1/large-data/uploads/{sid}/complete',json={},headers=e['headers']).status_code==409
    assert e['api'].get(f'/api/v1/large-data/uploads/{sid}',headers=e['headers']).json()['state']=='uploading'


def test_membership_revoked_cannot_issue_new_capability(env):
    e=env;sid=reserve(e).json()['id']
    with connect() as db:db.execute('delete from public.organization_members where user_id=%s and organization_id=%s',[e['owner'],e['org']])
    assert e['api'].post(f'/api/v1/large-data/uploads/{sid}/parts/1',json={},headers=e['headers']).status_code==404


def test_corrupt_data_remains_quarantined_and_quota_charged(env):
    e=env;data=b'@x\nACGT\n+\nIIII\n';sid=reserve(e,data,sha='a'*64).json()['id'];put(e,sid,1,data)
    e['api'].post(f'/api/v1/large-data/uploads/{sid}/complete',json={},headers=e['headers'])
    process_one(e['c'],str(uuid4()))
    result=e['api'].get('/api/v1/large-data/uploads/'+sid,headers=e['headers']).json()
    assert result['state']=='rejected' and result['summary'] is None and result['actual_sha256'] is None
    with connect() as db:assert db.execute('select charged_bytes from public.large_data_project_limits where project_id=%s',[e['project']]).fetchone()[0]==len(data)


def test_lost_completion_response_is_reconciled_without_duplicate_object(env):
    e=env;data=b'@x\nACGT\n+\nIIII\n';sid=reserve(e,data).json()['id'];put(e,sid,1,data)
    row=e['c'].rpc('acquire',p_owner=e['owner'],p_id=sid,p_operation='complete')
    e['c'].storage.complete(row,e['c'].storage.parts(row)) # Provider succeeds; process dies before DB update.
    assert e['api'].post(f'/api/v1/large-data/uploads/{sid}/complete',json={},headers=e['headers']).status_code==409
    with connect() as db:db.execute("update public.large_data_uploads set operation_started_at=now()-interval '16 minutes' where id=%s",[sid])
    out=e['api'].post(f'/api/v1/large-data/uploads/{sid}/complete',json={},headers=e['headers'])
    assert out.status_code==200 and out.json()['state']=='uploaded'


def test_two_verifiers_get_one_claim_and_expired_worker_cannot_publish(env):
    e=env;data=b'@x\nACGT\n+\nIIII\n';sid=reserve(e,data).json()['id'];put(e,sid,1,data)
    e['api'].post(f'/api/v1/large-data/uploads/{sid}/complete',json={},headers=e['headers'])
    storage=e['c'].storage.config.identity
    with concurrent.futures.ThreadPoolExecutor(2) as pool:
        claims=list(pool.map(lambda _:e['c'].rpc('claim',p_worker=str(uuid4()),p_storage=storage),range(2)))
    own=[x for x in claims if x and x['id']==sid]
    assert len(own)==1
    a=own[0]
    with connect() as db:db.execute("update public.large_data_uploads set lease_until=now()-interval '1 minute' where id=%s",[sid])
    assert e['c'].rpc('progress',p_id=sid,p_token=a['operation_token'],p_bytes=0) is False
    assert e['c'].rpc('finish_verification',p_id=sid,p_token=a['operation_token'],p_sha256=hashlib.sha256(data).hexdigest(),p_summary={},p_error=None) is False
