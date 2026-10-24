"""V64 real PostgreSQL/S3/FastAPI verification with source-bound VCF results."""
from __future__ import annotations
import gzip
import hashlib
from uuid import uuid4
from psycopg.types.json import Jsonb
from app.large_data.worker import process_one
from app.large_data.quality_report import check_digest, seal_report
from test_file_intake_v47 import heartbeat, uploaded, report
from conftest import connect

VCF = (b'##fileformat=VCFv4.3\n##reference=private-synthetic\n'
       b'#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tprivate-sample\n'
       b'chr1\t1\tsecret-a\tA\tG\t50\tPASS\t.\tGT:DP\t0/1:20\n'
       b'chr1\t2\tsecret-b\tG\tC\t.\tlowQual\t.\tGT:DP\t0/0:4\n')
ROOT='/api/v1/large-data'


def test_real_storage_private_vcf_site_qc_and_safe_tsv(env):
    e=env
    worker=heartbeat(e)
    data=gzip.compress(VCF)
    sid=uploaded(e,data,'tumor-synthetic.vcf.gz')
    assert report(e,sid).status_code==409
    assert process_one(e['c'],worker,universal=True)
    response=report(e,sid)
    assert response.status_code==200,response.text
    result=response.json()['report']
    check_digest(result)
    assert result['source_sha256']==hashlib.sha256(data).hexdigest()
    assert result['scientific_scope']=='full_vcf_site_qc'
    assert result['metrics']['record_count']==2
    assert result['metrics']['sample_count']==1
    assert result['metrics']['transitions']==1
    assert result['metrics']['transversions']==1
    assert result['metrics']['expanded_bytes']==len(VCF)
    assert result['intake']['inspection']=='complete_vcf'
    assert 'private-sample' not in response.text
    assert 'secret-a' not in response.text
    assert 'private-synthetic' not in response.text
    download=e['api'].get(ROOT+'/uploads/'+sid+'/quality-report?format=tsv',headers=e['headers'])
    assert download.status_code==200,download.text
    assert download.headers['cache-control']=='no-store'
    assert 'record_count\t2\n' in download.text
    assert 'private-sample' not in download.text and 'secret-' not in download.text
    assert e['api'].get(ROOT+'/uploads/'+sid+'/quality-report?format=tsv',headers={'Authorization':'Bearer outsider-token'}).status_code==404
    listed=e['api'].get(ROOT+'/projects/'+e['project']+'/files',headers=e['headers'])
    assert listed.status_code==200 and any(x['id']==sid for x in listed.json()['files'])


def test_invalid_vcf_auto_is_rejected_preserve_remains_inert(env):
    e=env
    worker=heartbeat(e)
    source=b'##fileformat=VCFv4.3\n#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\nchr1\tbad\tid\tA\tG\t5\tPASS\t.\n'
    bad=uploaded(e,source,'invalid-study.vcf')
    assert process_one(e['c'],worker,universal=True)
    state=e['api'].get(ROOT+'/uploads/'+bad,headers=e['headers']).json()
    assert state['state']=='rejected' and state['error_code']=='format_invalid'
    assert report(e,bad).status_code==409
    saved=uploaded(e,source,'keep-opaque.vcf',mode='preserve')
    assert process_one(e['c'],worker,universal=True)
    summary=report(e,saved).json()['report']
    assert summary['scientific_scope']=='bytes_only'
    assert summary['metrics'] is None and summary['intake']['inspection']=='integrity_only'


def test_tampered_resealed_vcf_result_fails_authorized_export(env):
    e=env
    worker=heartbeat(e)
    sid=uploaded(e,VCF,'integrity.vcf')
    assert process_one(e['c'],worker,universal=True)
    original=report(e,sid).json()['report']
    changed=dict(original)
    changed['metrics']=dict(original['metrics'])
    changed['metrics']['pass_sites']=999
    changed.pop('report_sha256')
    with connect() as db:
        db.execute('update public.large_data_uploads set summary=%s where id=%s',[Jsonb(seal_report(changed)),sid])
    assert report(e,sid).status_code==409
    assert e['api'].get(ROOT+'/uploads/'+sid+'/quality-report?format=tsv',headers=e['headers']).status_code==409
    assert e['api'].get(ROOT+'/projects/'+e['project']+'/files',headers=e['headers']).status_code==409