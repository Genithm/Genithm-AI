"""Isolated PostgreSQL + real S3-compatible container tests; NEVER a live Supabase DSN."""
from __future__ import annotations
import os
from pathlib import Path
from urllib.parse import urlsplit
from uuid import UUID,uuid4
import threading
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
import json

import pytest

DSN=os.getenv('GENITHM_LARGE_DATA_TEST_DSN','')
if not DSN:
    pytest.skip('isolated PostgreSQL integration environment not configured',allow_module_level=True)
u=urlsplit(DSN)
if u.hostname not in {'127.0.0.1','localhost'} or u.path!='/genithm_large_data_ci':
    raise RuntimeError('Refusing nonlocal or non-test PostgreSQL database')
import psycopg
from psycopg import sql
from psycopg.types.json import Jsonb
from app.supabase_gateway import SupabaseGateway
from app.large_data.routes import Clients,clients,router,LargeDataBodyLimit
from app.large_data.policy import LargeDataConfig,LargeDataError
from app.large_data.storage import MultipartStorage
from fastapi import FastAPI
from fastapi.testclient import TestClient

ROOT=Path(__file__).resolve().parents[2]
MIGRATION=ROOT/'supabase/migrations/20261018100826_managed_large_data_v44.sql'


def connect():return psycopg.connect(DSN,autocommit=True)


class SqlGateway(SupabaseGateway):
    def service_rpc(self,name,payload):
        if not name.startswith('large_data_') or not name.replace('_','').isalnum():raise ValueError('Unexpected function')
        with connect() as conn:
            conn.execute('set role service_role')
            query=sql.SQL('select public.{}({})').format(sql.Identifier(name),sql.SQL(',').join(
                sql.SQL('{} => %s').format(sql.Identifier(k)) for k in payload))
            try:
                value=conn.execute(query,[Jsonb(v) if isinstance(v,(dict,list)) else v for v in payload.values()]).fetchone()[0]
            except psycopg.Error as exc:
                code=exc.diag.message_primary
                from app.large_data.routes import SAFE_CODES
                raise LargeDataError(code,SAFE_CODES.get(code,409)) from None
            return value


@pytest.fixture(scope='session',autouse=True)
def database():
    with connect() as db:
        db.execute('''create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
         create schema auth; create schema app_private;
         grant usage on schema public,auth,app_private to service_role,authenticated,anon;
         create table auth.users(id uuid primary key);
         create table public.organizations(id uuid primary key);
         create table public.projects(id uuid primary key,organization_id uuid not null references organizations(id),status text not null);
         create table public.organization_members(organization_id uuid,user_id uuid,role text,primary key(organization_id,user_id));
         create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
         create function app_private.is_org_member(org uuid) returns boolean language sql stable security definer set search_path='' as
           $$select exists(select 1 from public.organization_members where organization_id=org and user_id=auth.uid())$$;
        ''')
        db.execute(MIGRATION.read_text())
        db.execute((ROOT/"supabase/migrations/20261018193000_large_data_pairs_v45.sql").read_text())
        db.execute((ROOT/"supabase/migrations/20261018205630_universal_file_intake_v47.sql").read_text())
    yield


@pytest.fixture
def env(database):
    owner,other,viewer,outsider,project,org=[str(uuid4()) for _ in range(6)]
    config=LargeDataConfig('http://127.0.0.1:9000','http://127.0.0.1:9000','genithm-large-data-ci-'+project[:8],
                          'genithm-ci','temporary-private-test-password',region="us-east-1",allow_loopback=True)
    storage=MultipartStorage(config)
    storage.client.create_bucket(Bucket=config.bucket)
    with connect() as db:
        db.execute('insert into public.organizations values(%s)',[org])
        for actor in (owner,other,viewer,outsider):db.execute('insert into auth.users values(%s)',[actor])
        for actor,role in [(owner,'owner'),(other,'member'),(viewer,'viewer')]:
            db.execute('insert into public.organization_members values(%s,%s,%s)',[org,actor,role])
        db.execute("insert into public.projects values(%s,%s,'active')",[project,org])
        db.execute('insert into public.large_data_project_limits(project_id,enabled,capacity_bytes) values(%s,true,%s)',[project,3*1024**3])
    token_map={'owner-token':owner,'other-token':other,'viewer-token':viewer,'outsider-token':outsider}
    class Auth(BaseHTTPRequestHandler):
        def do_GET(self):
            token=self.headers.get('Authorization','').removeprefix('Bearer ')
            ok=self.path=='/auth/v1/user' and token in token_map
            data=json.dumps({'id':token_map[token]} if ok else {'error':'invalid token'}).encode()
            self.send_response(200 if ok else 401);self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
        def log_message(self,*_):pass
    auth=ThreadingHTTPServer(('127.0.0.1',0),Auth)
    thread=threading.Thread(target=auth.serve_forever,daemon=True);thread.start()
    gateway=SqlGateway(url=f'http://127.0.0.1:{auth.server_port}',publishable_key='test-public',secret_key='unused-no-production-secrets')
    c=Clients(gateway,storage)
    c.rpc('heartbeat',p_worker=str(uuid4()),p_storage=config.identity)
    from app.large_data.pair_routes import router as pair_router
    app=FastAPI();app.include_router(router);app.include_router(pair_router);app.add_middleware(LargeDataBodyLimit)
    app.dependency_overrides[clients]=lambda:c
    api=TestClient(app)
    try:
        yield dict(c=c,api=api,owner=owner,other=other,viewer=viewer,outsider=outsider,project=project,org=org,
                   headers={'Authorization':'Bearer owner-token'})
    finally:
        api.close()
        auth.shutdown();auth.server_close();thread.join()
        # This fixture is hard-bound to loopback and a unique synthetic bucket.
        # Release actual 1/5 GiB objects between cases; no live research data is touched.
        for page in storage.client.get_paginator('list_multipart_uploads').paginate(Bucket=config.bucket):
            for item in page.get('Uploads',[]):
                storage.client.abort_multipart_upload(Bucket=config.bucket,Key=item['Key'],UploadId=item['UploadId'])
        for page in storage.client.get_paginator('list_objects_v2').paginate(Bucket=config.bucket):
            for item in page.get('Contents',[]):
                storage.client.delete_object(Bucket=config.bucket,Key=item['Key'])
        storage.client.delete_bucket(Bucket=config.bucket)
