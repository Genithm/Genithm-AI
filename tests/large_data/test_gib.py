from __future__ import annotations
import hashlib,json,os,subprocess,sys,time
from pathlib import Path
import pytest
from test_integration import reserve,put

@pytest.mark.skipif(os.getenv('GENITHM_RUN_GIB_E2E')!='1',reason='explicit full GiB acceptance run only')
def test_one_gib_actual_fastq_through_auth_quota_s3_resume_and_worker(env,tmp_path):
    e=env;record=b'@r0\n'+b'ACGT'*15+b'\n+\n'+b'I'*60+b'\n'
    assert len(record)==128
    size=1024**3;read_count=size//len(record);block=record*(1024**2//128)
    source=tmp_path/'synthetic.fastq';sha=hashlib.sha256()
    with source.open('wb') as f:
        for _ in range(1024):f.write(block);sha.update(block)
    assert source.stat().st_size==size and source.stat().st_blocks*512>=size
    start=time.perf_counter()
    response=reserve(e,size=size,sha=sha.hexdigest());assert response.status_code==201,response.text
    sid=response.json()['id'];chunk=64*1024**2
    with source.open('rb') as f:
        for number in range(1,5):put(e,sid,number,f.read(chunk))
    # New HTTP client state, persisted DB reservation and provider part receipts.
    known=e['api'].get('/api/v1/large-data/uploads/'+sid,headers=e['headers']).json()
    assert [p['number'] for p in known['parts']]==[1,2,3,4]
    with source.open('rb') as f:
        f.seek(4*chunk)
        for number in range(5,17):put(e,sid,number,f.read(chunk))
    assert e['api'].post('/api/v1/large-data/uploads/'+sid+'/complete',json={},headers=e['headers']).json()['state']=='uploaded'
    upload_seconds=time.perf_counter()-start
    child_env=dict(os.environ,GENITHM_TEST_BUCKET=e['c'].storage.config.bucket)
    run=subprocess.run([sys.executable,str(Path(__file__).with_name('worker_probe.py'))],env=child_env,
                       text=True,capture_output=True,check=True,timeout=600)
    measured=json.loads(run.stdout.strip().splitlines()[-1])
    result=e['api'].get('/api/v1/large-data/uploads/'+sid,headers=e['headers']).json()
    assert result['state']=='ready',result
    assert result['actual_sha256']==sha.hexdigest()
    metrics=result['summary']['metrics']
    assert metrics['read_count']==read_count and metrics['base_count']==read_count*60
    assert metrics['q30_bases']==read_count*60 and metrics['mean_phred']==40 and metrics['gc_percent']==50
    assert measured['peak_worker_rss_kib']<256*1024
    evidence={'source_bytes':size,'read_count':read_count,'source_sha256':sha.hexdigest(),
      'server_sha256':result['actual_sha256'],'source_physically_allocated':True,'parts':16,'parts_reused':4,
      'source_generation':'synthetic uncompressed 60-base FASTQ, Q40; not patient data',
      'upload_and_resume_seconds':upload_seconds,**measured,'result':result['summary'],
      'scope':'loopback real S3-compatible container and PostgreSQL; Auth is an isolated HTTP fixture, not live Supabase Auth'}
    out=Path(os.getenv('GENITHM_LARGE_DATA_EVIDENCE_DIR','artifacts/large-data'));out.mkdir(parents=True,exist_ok=True)
    (out/'one-gib-e2e.json').write_text(json.dumps(evidence,indent=2))
