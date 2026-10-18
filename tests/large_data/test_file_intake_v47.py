"""Real PostgreSQL/S3/API execution for universal intake; synthetic data only."""
from __future__ import annotations
import concurrent.futures
import gzip
import hashlib
import io
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
from uuid import uuid4
import pytest
from conftest import connect
from test_integration import put, age_links, reserve as legacy_reserve
from app.large_data.policy import LargeDataError
from app.large_data.verify import verify_stream
from app.large_data.worker import process_one
from app.large_data.quality_report import seal_report, check_digest
ROOT='/api/v1/large-data'


def heartbeat(e):
    worker=str(uuid4());e['c'].rpc('heartbeat_file_v47',p_worker=worker,p_storage=e['c'].storage.config.identity);return worker


def reserve(e,data=b'>private\nACGT\n',name='reference.fa',**extra):
    payload=dict(project_id=e['project'],request_id=str(uuid4()),filename=name,relative_path='study/'+name,
        batch_id=str(uuid4()),expected_bytes=len(data),expected_sha256=hashlib.sha256(data).hexdigest(),mode='auto')
    payload.update(extra)
    return e['api'].post(ROOT+'/files',headers=e['headers'],json=payload)


def uploaded(e,data=b'>private\nACGT\n',name='reference.fa',**extra):
    r=reserve(e,data,name,**extra);assert r.status_code==201,r.text
    sid=r.json()['id'];put(e,sid,1,data)
    r=e['api'].post(ROOT+'/uploads/'+sid+'/complete',headers=e['headers'],json={})
    assert r.status_code==200 and r.json()['state']=='uploaded',r.text
    return sid


def report(e,sid,token='owner-token'):
    return e['api'].get(ROOT+'/uploads/'+sid+'/file-report',headers={'Authorization':'Bearer '+token})


def test_capability_gating_and_old_worker_cannot_take_new_file(env):
    e=env
    assert reserve(e).status_code==503
    worker=heartbeat(e);sid=uploaded(e)
    assert e['c'].rpc('claim',p_worker=str(uuid4()),p_storage=e['c'].storage.config.identity) is None
    assert process_one(e['c'],worker,universal=True)
    r=report(e,sid);assert r.status_code==200,r.text
    assert r.json()['report']['intake']['fasta']['symbol_count']==4
    e['c'].rpc('heartbeat',p_worker=worker,p_storage=e['c'].storage.config.identity)
    assert reserve(e).status_code==503  # A legacy heartbeat cannot advertise V47.


@pytest.mark.parametrize('name,data,inspection', [
 ('ref.fna',b'>private\nACGTNN\n','complete_fasta'),('protein.faa.gz',gzip.compress(b'>private\nM*-\n'),'complete_fasta'),
 ('reads.fq.bgz',gzip.compress(b'@private\nACGT\n+\nIIII\n'),'complete_fastq'),
 ('sample.bam',b'\x1f\x8bnot-parsed-as-BAM','integrity_only'),('sample.h5ad',b'\x89HDF\r\n\x1a\nopaque-fixture','integrity_only'),
 ('sample.mzML',b'<xml>opaque-test-only</xml>','integrity_only'),('sample.cram',b'CRAMopaque-fixture','integrity_only'),
 ('sample.zip',b'PK\x03\x04../../never-extracted','integrity_only'),('data.newformat',b'\x00\xffbinary','integrity_only'),
 ('script.py',b'raise RuntimeError("must not execute")','integrity_only')])
def test_actual_upload_full_hash_report_and_permission_boundary(env,name,data,inspection):
    e=env;worker=heartbeat(e);sid=uploaded(e,data,name)
    assert report(e,sid).status_code==409
    assert process_one(e['c'],worker,universal=True)
    response=report(e,sid);assert response.status_code==200,response.text
    output=response.json();check_digest(output['report'])
    assert output['report']['source_sha256']==hashlib.sha256(data).hexdigest()
    assert output['report']['intake']['inspection']==inspection
    assert output['report']['intake']['malware_scan']=='not_performed'
    assert response.headers['cache-control']=='no-store' and response.headers['x-content-type-options']=='nosniff'
    assert output['relative_path']=='study/'+name
    for token in ['other-token','viewer-token','outsider-token']:
        assert report(e,sid,token).status_code==404
    assert report(e,sid,'fake-token').status_code==401
    assert 'object_key' not in response.text and 'operation_token' not in response.text


def test_format_failure_does_not_fallback_but_explicit_preserve_is_allowed(env):
    e=env;worker=heartbeat(e)
    a=uploaded(e,b'invalid scientific file','bad.fa')
    assert process_one(e['c'],worker,universal=True)
    state=e['api'].get(ROOT+'/uploads/'+a,headers=e['headers']).json()
    assert state['state']=='rejected' and state['error_code']=='format_invalid' and state['summary'] is None
    b=uploaded(e,b'invalid scientific file','bad.fa',mode='preserve')
    assert process_one(e['c'],worker,universal=True)
    assert report(e,b).json()['report']['intake']['inspection']=='integrity_only'


def test_request_replay_metadata_and_duplicate_batch_paths_are_atomic(env):
    e=env;heartbeat(e);request=str(uuid4());batch=str(uuid4())
    a=reserve(e,request_id=request,batch_id=batch);assert a.status_code==201,a.text
    assert reserve(e,request_id=request,batch_id=batch).json()['id']==a.json()['id']
    for changes in [{'mode':'preserve'},{'relative_path':'other/reference.fa'},{'batch_id':str(uuid4())}]:
        values=dict(request_id=request,batch_id=batch);values.update(changes)
        assert reserve(e,**values).status_code==409
    with concurrent.futures.ThreadPoolExecutor(2) as pool:
        rs=list(pool.map(lambda _:reserve(e,batch_id=batch,name='other.bam',data=b'opaque'),range(2)))
    assert sorted(r.status_code for r in rs)==[201,409]
    with connect() as db:
        actual=db.execute('select charged_bytes from public.large_data_project_limits where project_id=%s',[e['project']]).fetchone()[0]
    assert actual==len(b'>private\nACGT\n')+len(b'opaque')


def test_all_files_library_paginates_past_30_and_rejects_foreign_cursor(env):
    e=env;worker=heartbeat(e);batch=str(uuid4());ids=[]
    for n in range(33):
        sid=uploaded(e,b'\x00opaque',f'file-{n}.proprietary',batch_id=batch);ids.append(sid)
        assert process_one(e['c'],worker,universal=True)
    with connect() as db:
        db.execute("update public.large_data_uploads set created_at='2026-01-01' where project_id=%s",[e['project']])
    seen=[];cursor=None
    while True:
        page=e['api'].get(ROOT+'/projects/'+e['project']+'/files',params={'limit':7,**({'before':cursor} if cursor else {})},headers=e['headers'])
        assert page.status_code==200,page.text
        seen += [r['id'] for r in page.json()['files']];cursor=page.json()['next']
        if cursor is None:break
    assert seen==sorted(ids,reverse=True) and len(set(seen))==33
    assert e['api'].get(ROOT+'/projects/'+e['project']+'/files?before='+str(uuid4()),headers=e['headers']).status_code==422
    foreign={'Authorization':'Bearer other-token'}
    assert e['api'].get(ROOT+'/projects/'+e['project']+'/files?before='+ids[0],headers=foreign).status_code==422
    assert e['api'].get(ROOT+'/projects/'+e['project']+'/files?batch='+str(uuid4()),headers=e['headers']).json()['files']==[]


def test_revoked_access_stale_lease_and_semantic_tamper_are_fenced(env):
    e=env;worker=heartbeat(e);data=b'>private\nACGT\n';sid=uploaded(e,data)
    r=e['c'].rpc('claim_file_v47',p_worker=worker,p_storage=e['c'].storage.config.identity)
    digest,summary=verify_stream(io.BytesIO(data),r,10000)
    with connect() as db:db.execute("update public.organization_members set role='viewer' where user_id=%s",[e['owner']])
    assert e['c'].rpc('finish_verification',p_id=sid,p_token=r['operation_token'],p_sha256=digest,p_summary=summary,p_error=None) is False
    with connect() as db:
        db.execute("update public.organization_members set role='owner' where user_id=%s",[e['owner']])
        db.execute("update public.large_data_uploads set lease_until=now()-interval '1 minute' where id=%s",[sid])
    assert e['c'].rpc('finish_verification',p_id=sid,p_token=r['operation_token'],p_sha256=digest,p_summary=summary,p_error=None) is False
    assert process_one(e['c'],worker,universal=True)
    summary=report(e,sid).json()['report'];summary['intake']['fasta']['record_count']=False;summary.pop('report_sha256');summary=seal_report(summary)
    from psycopg.types.json import Jsonb
    with connect() as db:db.execute('update public.large_data_uploads set summary=%s where id=%s',[Jsonb(summary),sid])
    assert report(e,sid).status_code==409
    assert e['api'].get(ROOT+'/uploads/'+sid,headers=e['headers']).status_code==409
    assert e['api'].get(ROOT+'/projects/'+e['project']+'/files',headers=e['headers']).status_code==409


def test_v47_grants_and_row_security_remain_private(env):
    with connect() as db:
        rows=db.execute("select p.oid::regprocedure::text,has_function_privilege('anon',p.oid,'EXECUTE'),has_function_privilege('authenticated',p.oid,'EXECUTE'),has_function_privilege('service_role',p.oid,'EXECUTE') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'large_data_%v47'").fetchall()
        assert len(rows)==4 and all(row[1:]==(False,False,True) for row in rows)
        for table in ['large_data_uploads','large_data_worker_heartbeats','large_data_project_limits']:
            assert db.execute("select relrowsecurity from pg_class where oid=%s::regclass",['public.'+table]).fetchone()[0]
            for role in ['anon','authenticated']:
                assert not db.execute('select has_table_privilege(%s,%s,\'SELECT,INSERT,UPDATE,DELETE\')',[role,'public.'+table]).fetchone()[0]


@pytest.mark.skipif(os.getenv('GENITHM_RUN_GIB_E2E')!='1',reason='explicit full GiB acceptance only')
def test_one_gib_fasta_complete_upload_resume_and_fresh_universal_worker(env,tmp_path):
    e=env;heartbeat(e);size=1024**3;part=64*1024**2
    header=b'>synthetic-reference\n';record=header+b'A'*(1024**2-len(header)-1)+b'\n'
    assert shutil.disk_usage(tmp_path).free>size*2+1024**3
    source=tmp_path/'synthetic.fna';digest=hashlib.sha256()
    with source.open('wb') as f:
        for _ in range(1024):f.write(record);digest.update(record)
    assert source.stat().st_blocks*512>=size
    response=reserve(e,b'x','synthetic.fna',expected_bytes=size,expected_sha256=digest.hexdigest());assert response.status_code==201,response.text
    sid=response.json()['id']
    with source.open('rb') as f:
        for n in range(1,5):put(e,sid,n,f.read(part))
        from fastapi.testclient import TestClient
        with TestClient(e['api'].app) as api:
            assert len(api.get(ROOT+'/uploads/'+sid,headers=e['headers']).json()['parts'])==4
        for n in range(5,17):put(e,sid,n,f.read(part))
    assert e['api'].post(ROOT+'/uploads/'+sid+'/complete',headers=e['headers'],json={}).json()['state']=='uploaded'
    run=subprocess.run([sys.executable,str(Path(__file__).with_name('worker_probe.py'))],env={**os.environ,'GENITHM_TEST_BUCKET':e['c'].storage.config.bucket,'GENITHM_TEST_UNIVERSAL':'1'},text=True,capture_output=True,check=True,timeout=600)
    measured=json.loads(run.stdout.strip().splitlines()[-1]);response=report(e,sid);assert response.status_code==200,response.text
    envelope=response.json();check_digest(envelope['report']);fasta=envelope['report']['intake']['fasta']
    assert envelope['report']['source_sha256']==digest.hexdigest()
    assert fasta['record_count']==1024 and fasta['symbol_count']==1024*(1024**2-len(header)-1)
    assert fasta['symbol_counts']['A']==fasta['symbol_count'] and fasta['expanded_bytes']==size
    assert measured['peak_worker_rss_kib']<256*1024
    out=Path(os.environ['GENITHM_LARGE_DATA_EVIDENCE_DIR']);out.mkdir(parents=True,exist_ok=True)
    (out/'1-gib-fasta-v47.json').write_text(json.dumps({'source_bytes':size,'source_physically_allocated':True,'source_sha256':digest.hexdigest(),
        'recipe':'1024 one-MiB FASTA records, >synthetic-reference LF, all A symbols, LF; synthetic not patient data',
        'parts_reused':4,**measured,'file_report':envelope,'scope':'real PostgreSQL and S3-compatible storage on GitHub loopback; fixture authentication, not production or internet throughput'},indent=2))
    source.unlink()
