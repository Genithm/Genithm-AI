"""V48 signed original-download boundary: no raw bytes proxy, no foreign access."""
from __future__ import annotations
from types import SimpleNamespace
from uuid import uuid4
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from app.large_data.routes import router, clients
from app.large_data.verify import verify_stream
from app.large_data.file_registry import storage_format
from app.large_data.file_intake import file_report
from app.large_data.policy import LargeDataError
import hashlib
import io
import pytest


def record():
    data=b'>confidential-read\nACGTTGCA\n';owner=str(uuid4());project=str(uuid4());rid=str(uuid4())
    row={"id":rid,"organization_id":str(uuid4()),"project_id":project,"created_by":owner,
        "original_filename":"reference.fa","relative_path":"reference.fa","intake_mode":"auto",
        "expected_bytes":len(data),"checked_bytes":len(data),"expected_sha256":hashlib.sha256(data).hexdigest(),
        "data_format":storage_format('reference.fa','auto'),"object_etag":'"fixed"',"state":"ready"}
    sha,report=verify_stream(io.BytesIO(data),row,1024**2)
    row.update(actual_sha256=sha,summary=report)
    return row

class Fixture:
    def __init__(self):
        self.row=record();self.access=[]
        self.storage=SimpleNamespace(head=lambda row:{"etag":'"fixed"',"size":row['expected_bytes']},
            sign_download=lambda row:"https://private-storage.example/download?signature=secret")
    def auth(self,authorization):
        if authorization!='Bearer owner':raise HTTPException(401,"authentication_required")
        return self.row['created_by']
    def rpc(self,name,**params):
        self.access.append((name,params))
        if name!='get' or params.get('p_owner')!=self.row['created_by'] or params.get('p_id')!=self.row['id']:
            raise LargeDataError("not_found",404)
        return self.row

@pytest.fixture
def fixture():
    fake=Fixture();app=FastAPI();app.include_router(router)
    app.dependency_overrides[clients]=lambda:fake
    with TestClient(app) as browser:yield fake,browser

def test_download_original_requires_scope_and_full_report_and_current_etag(fixture):
    fake,browser=fixture;endpoint=f'/api/v1/large-data/uploads/{fake.row["id"]}/download'
    assert browser.get(endpoint).status_code==401
    assert browser.get(endpoint,headers={'Authorization':'Bearer wrong'}).status_code==401
    assert browser.get('/api/v1/large-data/uploads/'+str(uuid4())+'/download',headers={'Authorization':'Bearer owner'}).status_code==404
    response=browser.get(endpoint,headers={'Authorization':'Bearer owner'})
    assert response.status_code==200
    assert response.json()['source_sha256']==fake.row['expected_sha256']
    assert response.json()['source_bytes']==fake.row['expected_bytes']
    assert response.json()['expires_seconds']==120
    assert response.json()['url'].startswith('https://private-storage.example/')
    assert 'confidential-read' not in response.text
    assert response.headers['cache-control']=='no-store'
    fake.storage.head=lambda row:{'etag':'"changed"','size':row['expected_bytes']}
    assert browser.get(endpoint,headers={'Authorization':'Bearer owner'}).status_code==409
    fake.storage.head=lambda row:{'etag':'"fixed"','size':row['expected_bytes']}
    fake.row['summary']['intake']['fasta']['symbol_count']=999
    assert browser.get(endpoint,headers={'Authorization':'Bearer owner'}).status_code==409
    fake.row['state']='uploaded'
    assert browser.get(endpoint,headers={'Authorization':'Bearer owner'}).status_code==409


def test_download_original_never_accepts_input_storage_key_or_browser_digest(fixture):
    fake,browser=fixture;url=f'/api/v1/large-data/uploads/{fake.row["id"]}/download'
    headers={'Authorization':'Bearer owner'}
    assert browser.get(url,headers=headers,params={'key':'public/other','sha256':'a'*64}).status_code==200
    assert fake.access[-1][1]=={'p_owner':fake.row['created_by'],'p_id':fake.row['id']}


def test_download_storage_pre_sign_binds_fixed_scope():
    from app.large_data.storage import MultipartStorage
    class Signer:
        def generate_presigned_url(self,operation,**kwargs):
            assert operation=='get_object' and kwargs['ExpiresIn']==120 and kwargs['HttpMethod']=='GET'
            assert kwargs['Params']['ResponseContentDisposition']=='attachment'
            assert kwargs['Params']['Key'].startswith('quarantine/')
            return 'https://signed.example/fixture'
    row=record();config=SimpleNamespace(bucket='private',identity='a'*64)
    row.update(storage_identity=config.identity,object_key=f'quarantine/{row["organization_id"]}/{row["project_id"]}/{row["id"]}/input')
    storage=object.__new__(MultipartStorage);storage.config=config;storage.signer=Signer()
    assert storage.sign_download(row)=='https://signed.example/fixture'
    row['object_key']='public/exfiltration'
    with pytest.raises(LargeDataError,match='storage_scope_changed'):storage.sign_download(row)
