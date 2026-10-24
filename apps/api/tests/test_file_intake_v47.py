"""Whole-object intake, independent FASTA arithmetic and hostile metadata cases."""
from __future__ import annotations
import copy
import gzip
import hashlib
import io
import json
import random
from collections import Counter
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4
import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from app.large_data import fasta
from app.large_data.file_registry import FORMATS, VERSION, catalog, describe, header_kind, storage_format, validate_path
from app.large_data.file_intake import file_report, validate_intake
from app.large_data.policy import LargeDataError, PART_BYTES
from app.large_data.quality_report import seal_report, report_for_row, canonical
from app.large_data.routes import router, clients, LargeDataBodyLimit, public
from app.large_data.verify import verify_stream


def row(data, name='research.fa', mode='auto'):
    return dict(id=str(uuid4()), project_id=str(uuid4()), original_filename=name, relative_path='study/'+name,
        intake_mode=mode, batch_id=str(uuid4()), expected_bytes=len(data), checked_bytes=len(data),
        expected_sha256=hashlib.sha256(data).hexdigest(), data_format=storage_format(name, mode))


def verified(data, name='research.fa', mode='auto', **kwargs):
    r = row(data, name, mode)
    digest, summary = verify_stream(io.BytesIO(data), r, kwargs.pop('expanded', 100*1024**2), **kwargs)
    r.update(state='ready', actual_sha256=digest, summary=summary)
    return r


SUFFIXES = [(item['id'], ext) for item in FORMATS for ext in item['extensions']]
@pytest.mark.parametrize('fid,ext', SUFFIXES)
def test_every_registered_extension_roundtrips_as_a_name_hint(fid, ext):
    for name in ('example.'+ext, 'EXAMPLE.'+ext.upper(), 'example.'+ext+'.gz', 'example.'+ext+'.xz'):
        h = describe(name)
        assert h['format_id'] == fid and h['name_is_not_validation'] is True
    assert validate_path('example.'+ext, 'study/example.'+ext) == 'study/example.'+ext


def test_catalog_is_extensible_and_has_no_ambiguous_suffix_collision():
    assert len(SUFFIXES) == len(set(x[1] for x in SUFFIXES))
    c = catalog(); assert c['version'] == VERSION and c['accepts_unknown_extensions']
    assert not c['automatic_execution'] and not c['automatic_archive_extraction'] and not c['malware_scanning_available']
    assert describe('proprietary.no-such-extension')['format_id'] == 'unknown'
    assert describe('.zarray')['format_id'] == 'zarr'
    assert 'ambiguous' in describe('sample.map')['label']
    c['formats'][0]['extensions'].clear()
    assert FORMATS[0]['extensions']  # Do not expose mutable global catalogue state.


@pytest.mark.parametrize('extension', ['fq', 'FASTQ', 'fq.gz', 'fastq.bgz', 'fq.bgzf', 'fastq.gzip'])
def test_fastq_aliases_use_full_scientific_scanner(extension):
    raw = b'@private-read\nACGTN\n+\nI5!~?\n'
    data = gzip.compress(raw) if '.' in extension else raw
    r = verified(data, 'reads.'+extension)
    assert r['summary']['metrics']['read_count'] == 1
    assert r['summary']['metrics']['base_count'] == 5
    assert r['summary']['intake']['inspection'] == 'complete_fastq'
    assert file_report(r)['report'] == report_for_row(r)['report']
    assert b'private-read' not in canonical(r['summary'])


@pytest.mark.parametrize('seed', range(60))
def test_fasta_arithmetic_matches_independent_full_sequence_reference(seed, monkeypatch):
    rng = random.Random(seed)
    sequences = [''.join(rng.choices(fasta.SYMBOLS+'acgtn', k=rng.randint(1, 700))) for _ in range(rng.randint(1, 14))]
    raw = b''
    for n, seq in enumerate(sequences):
        width = rng.randint(1, 73)
        raw += ('>private-header-'+str(n)+'\r\n'+'\r\n'.join(seq[i:i+width] for i in range(0,len(seq),width))+'\r\n').encode()
    monkeypatch.setattr(fasta, 'CHUNK_BYTES', rng.choice([1,2,7,31,4096]))
    compressed = seed % 2 == 0
    r = verified(gzip.compress(raw) if compressed else raw, 'ref.fa.gz' if compressed else 'ref.fa')
    summary = r['summary']['intake']['fasta']
    lengths = list(map(len, sequences)); counts = Counter(''.join(sequences).upper())
    assert summary['record_count'] == len(sequences)
    assert summary['symbol_count'] == sum(lengths)
    assert (summary['minimum_length'],summary['maximum_length']) == (min(lengths),max(lengths))
    assert summary['mean_length'] == pytest.approx(sum(lengths)/len(lengths))
    assert summary['symbol_counts'] == {s:counts[s] for s in fasta.SYMBOLS}
    assert summary['expanded_bytes'] == len(raw)
    assert file_report(r)['report'] == r['summary']
    assert b'private-header' not in canonical(r['summary'])


@pytest.mark.parametrize('raw', [b'',b'ACGT',b'>\nACG\n',b'>x\n',b'>x\n>y\nA\n',b'>x\nA1\n',b'>x\nA>y\n',b'>\x00\nA\n',b'>\xff\nA\n',b'>x\n\xff\n'])
def test_malformed_auto_fasta_fails_instead_of_silent_bytes_only_downgrade(raw):
    stream = io.BytesIO(raw)
    with pytest.raises(LargeDataError, match='format_invalid'):
        verify_stream(stream, row(raw), 10000)
    assert stream.closed


def test_gzip_fasta_concatenated_members_boundaries_and_no_final_newline():
    first, second = b'>a\nACTGN\n', b'>b\nM*-.'
    r = verified(gzip.compress(first)+gzip.compress(second), 'proteins.faa.bgzf')
    assert r['summary']['intake']['fasta']['record_count'] == 2
    assert r['summary']['intake']['fasta']['symbol_count'] == 9
    assert r['summary']['intake']['observed_header'] == 'gzip'
    file_report(r)


@pytest.mark.parametrize('kind', ['truncated','deflate','expanded','header','checksum','cancel'])
def test_fasta_complete_verification_fails_closed(kind):
    data = gzip.compress(b'>x\n'+b'A'*4096+b'\n'); name='x.fa.gz'; options={}
    if kind=='truncated':data=data[:-4]
    elif kind=='deflate':data=b'\x1f\x8b\x08\x00'+b'\x00'*6+b'\xff'*32
    elif kind=='expanded':options['expanded']=100
    elif kind=='header':data=b'>'+b'x'*4097+b'\nA\n';name='x.fa'
    elif kind=='cancel':options['cancelled']=lambda:True
    if kind=='checksum':
        r=row(data,name);r['expected_sha256']='0'*64
        with pytest.raises(LargeDataError,match='checksum_mismatch'):verify_stream(io.BytesIO(data),r,10000)
    else:
        with pytest.raises(LargeDataError):verified(data,name,**options)


def test_unwrapped_long_fasta_has_bounded_allocations_and_reads():
    import tracemalloc
    class LongSource(io.RawIOBase):
        def __init__(self):self.left=32*1024**2;self.first=True;self.h=hashlib.sha256();self.last=False
        def read(self,n):
            assert 0<n<=1024**2
            if self.first:self.first=False;data=b'>x\n'
            elif self.left:data=b'A'*min(n,self.left);self.left-=len(data)
            elif not self.last:self.last=True;data=b'\n'
            else:data=b''
            self.h.update(data);return data
    # Reference hash built incrementally and independent of the scanner.
    h=hashlib.sha256(b'>x\n')
    for _ in range(32):h.update(b'A'*1024**2)
    h.update(b'\n')
    r=row(b'x');r.update(expected_bytes=32*1024**2+4,expected_sha256=h.hexdigest())
    source=LongSource();tracemalloc.start()
    _,result=verify_stream(source,r,40*1024**2)
    _,peak=tracemalloc.get_traced_memory();tracemalloc.stop()
    assert source.closed and peak<16*1024**2
    assert result['intake']['fasta']['symbol_count']==32*1024**2
    assert result['intake']['prefix_bytes_inspected']==65536


@pytest.mark.parametrize('name,magic,observed', [
    ('sample.bam',b'\x1f\x8b','gzip'),('sample.cram',b'CRAM','cram'),('sample.bcf',b'BCF\x02','bcf'),
    ('sample.h5ad',b'\x89HDF\r\n\x1a\n','hdf5'),('sample.pod5',b'POD5','unknown'),
    ('sample.mzML',b'<xml>','unknown'),('counts.mtx',b'%%MatrixMarket','unknown'),
    ('anno.gff3',b'##gff-version 3','gff_hint'),
    ('model.pdb',b'HEADER','unknown'),('script.py',b'print("not executed")','unknown'),
    ('data.RDS',b'X\n','unknown'),('archive.zip',b'PK\x03\x04../../etc/not-extracted','zip'),
    ('notes.pdf',b'%PDF-','pdf'),('file.proprietary',b'\x7fELF','elf'),('file.exe',b'MZ','pe'),
    ('no-extension',b'\x00\xff','unknown')])
def test_all_other_files_are_inert_exact_bytes_not_fake_scientific_results(name,magic,observed):
    data=magic+b'\x00\xfe\xff\n'*20000
    r=verified(data,name);v=r['summary'];i=v['intake']
    assert v['source_sha256']==hashlib.sha256(data).hexdigest()
    assert v['metrics'] is None and i['inspection']=='integrity_only'
    assert i['observed_header']==observed and i['prefix_bytes_inspected']==65536
    assert i['archive_extraction']==i['malware_scan']=='not_performed'
    file_report(r)


@pytest.mark.parametrize('name', ['bad.fasta','bad.fastq','bad.fq.gz','bad.fa.bgz'])
def test_explicit_preserve_mode_accepts_unparsable_sequence_bytes(name):
    r=verified(b'not a biological record',name,'preserve')
    assert r['summary']['intake']['inspection']=='integrity_only'
    assert 'inspection_explicitly_disabled' in r['summary']['intake']['warnings']
    assert r['data_format']=='opaque'
    file_report(r)


@pytest.mark.parametrize('path', ['../x.fa','study/../x.fa','/x.fa','study//x.fa','study/x.fa/','a\\x.fa','a:x.fa','a/ x.fa','a\x00/x.fa','a\u202e/x.fa','a/'+('a'*256)+'/x.fa','study/y.fa'])
def test_unsafe_relative_paths_are_rejected(path):
    with pytest.raises(LargeDataError):validate_path('x.fa',path)


@pytest.mark.parametrize('name', ['','.', '..','/x','a\\b',' x.fa','x.fa ','x\n.fa','a:b','a\u202e.fa','a\ud800','x'*256])
def test_unsafe_filenames_are_rejected(name):
    with pytest.raises(LargeDataError):validate_path(name)


@pytest.mark.parametrize('mutation', [
    lambda r:r['summary'].__setitem__('source_bytes',True),
    lambda r:r['summary']['intake'].__setitem__('inspection','complete_fastq'),
    lambda r:r['summary']['intake'].__setitem__('observed_header','<script>'),
    lambda r:r['summary']['intake'].__setitem__('prefix_bytes_inspected',True),
    lambda r:r['summary']['intake'].__setitem__('warnings',['unsupported']),
    lambda r:r['summary']['intake'].__setitem__('malware_scan','passed'),
    lambda r:r['summary']['intake']['fasta'].__setitem__('record_count',True),
    lambda r:r['summary']['intake']['fasta'].__setitem__('symbol_count',999),
    lambda r:r['summary']['intake']['fasta'].__setitem__('mean_length',0),
    lambda r:r['summary']['intake']['fasta'].__setitem__('sampling',True),
    lambda r:r.__setitem__('original_filename','changed.bam'),
    lambda r:r.__setitem__('intake_mode','preserve'),
    lambda r:r.__setitem__('actual_sha256','0'*64),
    lambda r:r.__setitem__('checked_bytes',0),
])
def test_semantic_tampering_is_rejected_even_after_resealing(mutation):
    r=verified(b'>private\nACGT\n');mutation(r)
    r['summary'].pop('report_sha256')
    r['summary']=seal_report(r['summary'])
    with pytest.raises(LargeDataError):file_report(r)


class Fixture:
    def __init__(self):
        self.r=verified(b'>private\nACGT\n');self.calls=[]
        self.storage=SimpleNamespace(config=SimpleNamespace(identity='a'*64),create=lambda r:'provider-fixture')
    def auth(self,auth):
        if auth!='Bearer valid':raise HTTPException(401,'authentication_required')
        return str(uuid4())
    def rpc(self,name,**p):
        self.calls.append((name,p))
        if name=='get' and p['p_id']!=self.r['id']:raise LargeDataError('not_found',404)
        if name=='reserve_file_v47':
            return {**self.r,'state':'uploading','original_filename':p['p_filename'],'relative_path':p['p_path']}
        if name=='files_page_v47':return {'files':[self.r],'next':None,'project_id':self.r['project_id'],'batch_id':None}
        return self.r


@pytest.fixture
def fixture():
    f=Fixture();app=FastAPI();app.include_router(router);app.add_middleware(LargeDataBodyLimit)
    app.dependency_overrides[clients]=lambda:f
    with TestClient(app) as api:yield f,api,{'Authorization':'Bearer valid'}


def test_new_api_derives_format_and_never_trusts_browser_analysis(fixture):
    f,api,h=fixture
    payload={'project_id':f.r['project_id'],'request_id':str(uuid4()),'filename':'reads.FQ.bgz',
        'relative_path':'study/reads.FQ.bgz','batch_id':str(uuid4()),'expected_bytes':10,'expected_sha256':'a'*64}
    assert api.post('/api/v1/large-data/files',headers=h,json=payload).status_code==201
    assert f.calls[-1][1]['p_format']=='fastq.gz'
    for extra in ({'data_format':'opaque'},{'metrics':{}},{'mode':'execute'},{'expected_bytes':True},{'relative_path':'../reads.FQ.bgz'}):
        assert api.post('/api/v1/large-data/files',headers=h,json={**payload,**extra}).status_code==422
    assert api.post('/api/v1/large-data/files',json=payload).status_code==401


def test_file_library_and_reports_are_authenticated_and_bounded(fixture):
    f,api,h=fixture
    url='/api/v1/large-data/uploads/'+f.r['id']+'/file-report'
    assert api.get(url).status_code==401
    response=api.get(url,headers=h);assert response.status_code==200
    assert response.headers['cache-control']=='no-store' and response.headers['x-content-type-options']=='nosniff'
    assert 'attachment' in response.headers['content-disposition']
    assert response.json()['report']==f.r['summary']
    assert 'private' not in response.text
    root='/api/v1/large-data/projects/'+f.r['project_id']+'/files'
    assert api.get(root,headers=h).status_code==200
    for query in ['?limit=101','?limit=0','?before=bad']:
        assert api.get(root+query,headers=h).status_code==422
    f.r['summary']['intake']['inspection']='wrong'
    assert api.get(url,headers=h).status_code==409


def test_legacy_checksum_reports_remain_supported_without_inventing_intake():
    r=row(b'opaque','old.bam');r.pop('intake_mode')
    digest,summary=verify_stream(io.BytesIO(b'opaque'),r,1000)
    r.update(state='ready',actual_sha256=digest,summary=summary)
    assert 'intake' not in file_report(r)['report']


def test_code_does_not_call_archive_extract_deserializers_or_execution():
    for name in ('file_registry.py','file_intake.py','fasta.py'):
        source=(Path(__file__).parents[1]/'app/large_data'/name).read_text()
        for prohibited in ('extractall(', 'pickle.load(', 'eval(', 'exec(', 'subprocess.', 'os.system('):
            assert prohibited not in source
