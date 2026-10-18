from __future__ import annotations

import gzip
import hashlib
import io
import json
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from app.large_data.policy import LargeDataConfig, LargeDataError, MAX_BYTES, PART_BYTES, part_size
from app.large_data.verify import verify_stream, HashingReader
from app.large_data.routes import router, clients, LargeDataBodyLimit, Clients, public
from app.large_data.worker import process_one
from app.supabase_gateway import SupabaseGateway, SupabaseGatewayError

FASTQ = b'@one\nACGTN\n+\nIIIII\n@two\nGCAA\n+\n5555\n'


def row(data=FASTQ, format='fastq'):
    return dict(id=str(uuid4()),organization_id=str(uuid4()),project_id=str(uuid4()),created_by=str(uuid4()),
        expected_bytes=len(data),expected_sha256=hashlib.sha256(data).hexdigest(),data_format=format,
        state='uploaded',operation_token=str(uuid4()),object_etag='"etag"',part_bytes=PART_BYTES)


class Body(io.BytesIO):
    largest = 0
    def read(self,n=-1):
        assert 0 <= n <= 1024**2, 'No unbounded reads'
        self.largest = max(self.largest,n)
        return super().read(n)


@pytest.mark.parametrize('compressed',[False,True])
def test_actual_complete_fastq_and_gzip_qc(compressed):
    data=gzip.compress(FASTQ) if compressed else FASTQ
    stream=Body(data);r=row(data,'fastq.gz' if compressed else 'fastq');progress=[]
    digest,result=verify_stream(stream,r,10000,progress.append)
    assert digest==hashlib.sha256(data).hexdigest()
    assert stream.closed
    assert result['source_bytes']==len(data)
    assert result['metrics']['read_count']==2
    assert result['metrics']['base_count']==9
    assert result['metrics']['base_counts']==dict(A=3,C=2,G=2,T=1,N=1)
    assert result['metrics']['q20_bases']==9 and result['metrics']['q30_bases']==5
    assert result['metrics']['mean_phred']==pytest.approx(280/9)
    assert result['metrics']['gc_percent']==50
    assert result['metrics']['sampling'] is False
    assert progress[-1]==len(data)
    assert b'@one' not in json.dumps(result).encode()


@pytest.mark.parametrize('data',[b'',b'not-fastq',b'@x\nACXT\n+\nIIII\n',b'@x\nACGT\n+\nIII\n',
    b'@x\nACGT\n+wrong\nIIII\n',b'@x\nACGT\n+\n    \n',b'@x\nACGT\n+\nIIII\n\n'])
def test_invalid_fastq_never_yields_success(data):
    stream=Body(data)
    with pytest.raises(LargeDataError,match='format_invalid'):verify_stream(stream,row(data),10000)
    assert stream.closed


def test_trailing_no_newline_and_crlf():
    for data in [FASTQ.rstrip(b'\n'),FASTQ.replace(b'\n',b'\r\n')]:
        assert verify_stream(Body(data),row(data),10000)[1]['metrics']['read_count']==2


def test_checksum_mismatch_and_truncated_transfer_reject_closed():
    r=row();r['expected_sha256']='a'*64
    with pytest.raises(LargeDataError,match='checksum_mismatch'):verify_stream(Body(FASTQ),r,1000)
    r=row();r['expected_bytes']+=10
    with pytest.raises(LargeDataError,match='transfer_error'):verify_stream(Body(FASTQ),r,1000)
    r=row();r['expected_bytes']-=1
    with pytest.raises(LargeDataError,match='source_changed'):verify_stream(Body(FASTQ),r,1000)


def test_gzip_crc_truncation_and_decompression_budget():
    data=gzip.compress(FASTQ)
    with pytest.raises(LargeDataError,match='format_invalid'):verify_stream(Body(data[:-4]),row(data[:-4],'fastq.gz'),1000)
    with pytest.raises(LargeDataError,match='resource_limit'):verify_stream(Body(data),row(data,'fastq.gz'),5)


def test_opaque_verified_but_not_biologically_analyzed():
    data=bytes(range(256))*10000
    result=verify_stream(Body(data),row(data,'opaque'),10000000)[1]
    assert result['scientific_scope']=='bytes_only' and result['metrics'] is None


def test_lease_loss_stops_read_without_publishing():
    with pytest.raises(LargeDataError,match='lease_lost'):verify_stream(Body(FASTQ),row(),1000,cancelled=lambda:True)


def test_deadline_and_long_header_limits():
    with pytest.raises(LargeDataError,match='resource_limit'):verify_stream(Body(FASTQ),row(),1000,max_seconds=-1)
    data=b'@'+b'x'*5000+b'\nACGT\n+\nIIII\n'
    with pytest.raises(LargeDataError,match='resource_limit'):verify_stream(Body(data),row(data),10000)


def test_part_geometry_and_type_boundaries():
    assert part_size(5*1024**3,80)==64*1024**2
    assert part_size(PART_BYTES+3,2)==3
    assert part_size(MAX_BYTES,1600)==PART_BYTES
    for x,n in [(0,1),(True,1),(MAX_BYTES+1,1),(3,2),(10,False)]:
        with pytest.raises(LargeDataError):part_size(x,n)


@pytest.mark.parametrize('url',['http://s3.invalid','https://key:secret@s3.invalid','https://s3.invalid/?secret=abc','https://s3.invalid/path'])
def test_no_insecure_or_credential_bearing_endpoints(url):
    with pytest.raises(ValueError):LargeDataConfig(url,url,'private-bucket','key','secret')


def test_local_http_is_explicit_test_only():
    conf=LargeDataConfig('http://127.0.0.1:9000','http://127.0.0.1:9000','private-bucket','key','secret',allow_loopback=True)
    assert len(conf.identity)==64
    with pytest.raises(ValueError):LargeDataConfig('http://evil.invalid','http://evil.invalid','private-bucket','key','secret',allow_loopback=True)


class FakeClients:
    def __init__(self):
        self.row=row();self.row['state']='uploading';self.calls=[];self.signs=0;self.cleaned=False
        self.storage=SimpleNamespace(config=SimpleNamespace(identity='a'*64,max_expanded_bytes=10000),
            parts=lambda row:[dict(number=1,size=len(FASTQ),etag='receipt')],
            validate_parts=lambda row,parts:None, head=lambda row:dict(size=len(FASTQ),etag='"etag"'),
            create=lambda row:'upload-opaque-id', sign=self.sign, complete=lambda row,p:None,
            cleanup=self.cleanup, open=lambda row:Body(FASTQ))
    def auth(self,header):
        if header!='Bearer owner-token':raise __import__('fastapi').HTTPException(401,'authentication_required')
        return self.row['created_by']
    def sign(self,row,number):self.signs+=1;return 'https://store.invalid/signed-part'
    def cleanup(self,row):self.cleaned=True
    def rpc(self,name,**params):
        self.calls.append((name,params))
        if name in ('get','sign_part') and params.get('p_id')!=self.row['id']:raise LargeDataError('not_found',404)
        if name=='finish_operation':self.row['state']={'complete':'uploaded','initialize':'uploading','abort':'aborted'}[params['p_operation']]
        if name=='reserve':self.row['state']='reserved'
        if name=='progress':return True
        return self.row.copy()


@pytest.fixture
def client():
    fake=FakeClients();app=FastAPI();app.include_router(router);app.add_middleware(LargeDataBodyLimit)
    app.dependency_overrides[clients]=lambda:fake
    return TestClient(app),fake


def test_unauthenticated_cannot_get_or_sign(client):
    c,f=client
    assert c.get('/api/v1/large-data/uploads/'+f.row['id']).status_code==401
    assert c.post('/api/v1/large-data/uploads/'+f.row['id']+'/parts/1',json={}).status_code==401
    assert not f.calls and f.signs==0


def test_other_upload_id_denied_before_signer(client):
    c,f=client
    r=c.post('/api/v1/large-data/uploads/'+str(uuid4())+'/parts/1',json={},headers={'Authorization':'Bearer owner-token'})
    assert r.status_code==404 and f.signs==0


def test_public_status_never_returns_credentials_paths_or_leases(client):
    c,f=client;f.row.update(provider_upload_id='s3-id',object_key='secret-path',operation_token='lease',storage_identity='x')
    result=c.get('/api/v1/large-data/uploads/'+f.row['id'],headers={'Authorization':'Bearer owner-token'}).json()
    assert 'operation_token' not in result and 'object_key' not in result and 'provider_upload_id' not in result
    assert result['parts'][0]['size']==len(FASTQ)


def test_control_plane_refuses_raw_file_bodies(client):
    c,_=client
    assert c.post('/api/v1/large-data/uploads',content=b'x'*16385).status_code==413
    assert c.post('/api/v1/large-data/uploads',content=iter([b'{}'])).status_code==411


def test_creation_rejects_owner_or_storage_path_injection(client):
    c,f=client
    request=dict(project_id=f.row['project_id'],request_id=str(uuid4()),filename='study.fastq',
                 expected_bytes=len(FASTQ),expected_sha256=hashlib.sha256(FASTQ).hexdigest(),data_format='fastq',created_by=str(uuid4()))
    assert c.post('/api/v1/large-data/uploads',json=request,headers={'Authorization':'Bearer owner-token'}).status_code==422
    del request['created_by'];request['filename']='../../foreign.fastq'
    assert c.post('/api/v1/large-data/uploads',json=request,headers={'Authorization':'Bearer owner-token'}).status_code==422


def test_completed_upload_is_queued_not_declared_scientific_success(client):
    c,f=client
    result=c.post('/api/v1/large-data/uploads/'+f.row['id']+'/complete',json={},headers={'Authorization':'Bearer owner-token'})
    assert result.status_code==200 and result.json()['state']=='uploaded'
    assert result.json()['summary'] is None


def test_actual_worker_claim_stream_and_finish_path():
    fake=FakeClients();fake.row['state']='uploaded'
    assert process_one(fake,str(uuid4())) is True
    name,payload=fake.calls[-1]
    assert name=='finish_verification' and payload['p_sha256']==hashlib.sha256(FASTQ).hexdigest()
    assert payload['p_error'] is None and payload['p_summary']['metrics']['read_count']==2


def test_worker_does_not_finish_with_valid_hash_on_corruption():
    fake=FakeClients();fake.row['expected_sha256']='c'*64
    process_one(fake,str(uuid4()))
    assert fake.calls[-1][1]['p_error']=='checksum_mismatch'
    assert fake.calls[-1][1]['p_summary'] is None and fake.calls[-1][1]['p_sha256'] is None


def test_existing_gateway_rejects_forged_auth_response(monkeypatch):
    g=SupabaseGateway(url='https://supabase.invalid',publishable_key='public',secret_key='private')
    monkeypatch.setattr(g,'_json_request',lambda *_args,**_kw:{'role':'service_role'})
    with pytest.raises(SupabaseGatewayError):g.authenticate('Bearer forged')


def test_gateway_errors_are_sanitized():
    g=SimpleNamespace(service_rpc=lambda *_:(_ for _ in ()).throw(SupabaseGatewayError('private-path SQL INTERNAL')))
    with pytest.raises(LargeDataError,match='large_data_database_unavailable'):Clients(g,None).rpc('get',p_owner='x')
