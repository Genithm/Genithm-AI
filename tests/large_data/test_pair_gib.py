"""Complete 1 GiB R1 + 1 GiB R2 acceptance, distinct record identifiers, no sampling."""
from __future__ import annotations
import hashlib,json,os,shutil,subprocess,sys,time
from pathlib import Path
from uuid import uuid4
import pytest
from conftest import connect
from test_integration import reserve,put
from test_pair_integration import enqueue

@pytest.mark.skipif(os.getenv('GENITHM_RUN_GIB_E2E')!='1',reason='explicit full GiB integration only')
def test_complete_two_gib_paired_inputs(env,tmp_path,monkeypatch):
    e=env;monkeypatch.setenv('GENITHM_LARGE_DATA_PAIRING_ENABLED','true')
    size=1024**3; records=size//128
    assert shutil.disk_usage(tmp_path).free>5*size,'Need real source files plus distinct object-store copies'
    with connect() as db:
        db.execute('update public.large_data_project_limits set capacity_bytes=%s where project_id=%s',[3*size,e['project']])
    paths=[];hashes=[]
    # Fully allocated unique-ID inputs; all records are exactly 128 bytes.
    for mate in (1,2):
        path=tmp_path/f'synthetic-R{mate}.fastq'; digest=hashlib.sha256()
        sequence=(b'ACGT'*14)[:53] if mate==1 else (b'TGCA'*14)[:53]
        tail=b'\n'+sequence+b'\n+\n'+b'I'*53+b'\n'
        with path.open('wb') as file:
            for start in range(0,records,8192):
                block=b''.join((f'@r{i:013d}/{mate}'.encode()+tail) for i in range(start,min(start+8192,records)))
                file.write(block);digest.update(block)
        assert path.stat().st_size==size and path.stat().st_blocks*512>=size
        paths.append(path);hashes.append(digest.hexdigest())
    ids=[]; started=time.perf_counter();part_size=64*1024**2
    for path,digest in zip(paths,hashes):
        e['c'].rpc('heartbeat',p_worker=str(uuid4()),p_storage=e['c'].storage.config.identity)
        r=reserve(e,size=size,sha=digest);assert r.status_code==201,r.text
        sid=r.json()['id']
        with path.open('rb') as f:
            for number in range(1,5):put(e,sid,number,f.read(part_size))
        status=e['api'].get('/api/v1/large-data/uploads/'+sid,headers=e['headers']).json()
        assert [p['number'] for p in status['parts']]==[1,2,3,4]
        with path.open('rb') as f:
            f.seek(4*part_size)
            for number in range(5,17):put(e,sid,number,f.read(part_size))
        assert e['api'].post('/api/v1/large-data/uploads/'+sid+'/complete',json={},headers=e['headers']).status_code==200
        child_env=dict(os.environ,GENITHM_TEST_BUCKET=e['c'].storage.config.bucket)
        subprocess.run([sys.executable,str(Path(__file__).with_name('worker_probe.py'))],env=child_env,
                       capture_output=True,text=True,check=True,timeout=600)
        status=e['api'].get('/api/v1/large-data/uploads/'+sid,headers=e['headers']).json()
        assert status['state']=='ready' and status['actual_sha256']==digest
        ids.append(sid)
    e['c'].rpc('pair_heartbeat',p_worker=str(uuid4()),p_storage=e['c'].storage.config.identity)
    response=enqueue(e,*ids);assert response.status_code==201,response.text
    pid=response.json()['id']
    result=subprocess.run([sys.executable,str(Path(__file__).with_name('pair_worker_probe.py'))],env=child_env,
                          capture_output=True,text=True,check=True,timeout=600)
    measured=json.loads(result.stdout.strip().splitlines()[-1])
    out=e['api'].get('/api/v1/large-data/pairs/'+pid,headers=e['headers']).json()
    assert out['state']=='ready',out
    summary=out['summary']
    assert summary['pair_count']==records and summary['explicit_mate_labels']==records
    assert summary['source_sha256']==hashes and summary['source_bytes']==[size,size]
    assert summary['unlabeled_pairs']==0 and summary['sampling'] is False
    for metrics in summary['mates']:
        assert metrics['read_count']==records and metrics['base_count']==records*53
        assert metrics['q30_bases']==records*53 and metrics['mean_phred']==40
    response=e['api'].get('/api/v1/large-data/pairs/'+pid+'/quality-report',headers=e['headers'])
    assert response.status_code==200,response.text
    envelope=response.json()
    for metric in envelope['report']['mates']:
        profile=metric['quality_profile']
        assert sum(row[2] for row in profile['positions'])==records*53
        assert all(row[3]==40*row[2] and row[11:]==[40]*5 for row in profile['positions'])
        assert profile['read_mean_phred_counts'][40]==records
        assert profile['read_lengths']==[[51,53,records]]
    assert measured['peak_pair_worker_rss_kib']<256*1024
    evidence={'input_bytes':[size,size],'fully_allocated':True,'pairs':records,'source_sha256':hashes,
        'distinct_ordered_identifiers':True,'input_description':'Synthetic 53-base Q40 reads with unique numeric read IDs, not patient data',
        'application_path_seconds':time.perf_counter()-started,**measured,'result':summary,'quality_report':envelope,
        'scope':'Real API routes/PostgreSQL/S3 on GitHub loopback; fixture authentication. Not live-provider or browser memory/latency.'}
    target=Path(os.getenv('GENITHM_LARGE_DATA_EVIDENCE_DIR','artifacts/large-data'));target.mkdir(exist_ok=True,parents=True)
    (target/'paired-2-gib-e2e.json').write_text(json.dumps(evidence,indent=2))
    for path in paths:path.unlink()
