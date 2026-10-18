"""Two physically allocated 1 GiB FASTQs: real upload, verification and complete pairing."""
import hashlib, json, os, shutil, subprocess, sys, time
from pathlib import Path
from uuid import uuid4
import pytest
from test_integration import reserve, put
from test_pairs import paired, submit, status

@pytest.mark.skipif(os.getenv('GENITHM_RUN_GIB_E2E')!='1', reason='explicit isolated full-byte acceptance only')
def test_two_full_gib_files_complete_paired_workflow(paired, tmp_path):
    e=paired; size=1024**3; count=size//256; part=64*1024**2
    assert shutil.disk_usage(tmp_path).free>5*1024**3,'Insufficient scratch; do not substitute sparse files'
    paths=[tmp_path/'R1.fastq',tmp_path/'R2.fastq']; hashes=[hashlib.sha256(),hashlib.sha256()]
    # Unique fixed-width synthetic identifiers, varied mate qualities, no patient data.
    sequences=[b'ACGTN'*20,b'TGCAN'*20]; qualities=[b'I'*50+b'#'*50,b'5'*100]
    with paths[0].open('wb') as f1, paths[1].open('wb') as f2:
        for start in range(0,count,4096):
            for mate,out in enumerate((f1,f2),1):
                block=b''.join(f'@{i:048d}/{mate}\n'.encode()+sequences[mate-1]+b'\n+\n'+qualities[mate-1]+b'\n'
                    for i in range(start,start+4096))
                assert len(block)==1024**2
                out.write(block);hashes[mate-1].update(block)
    ids=[]; started=time.perf_counter()
    for source,digest in zip(paths,hashes):
        e['c'].rpc('heartbeat',p_worker=str(uuid4()),p_storage=e['c'].storage.config.identity)
        assert source.stat().st_size==size and source.stat().st_blocks*512>=size
        response=reserve(e,size=size,sha=digest.hexdigest());assert response.status_code==201,response.text
        sid=response.json()['id'];ids.append(sid)
        with source.open('rb') as f:
            for n in range(1,17):put(e,sid,n,f.read(part))
        assert e['api'].post('/api/v1/large-data/uploads/'+sid+'/complete',json={},headers=e['headers']).json()['state']=='uploaded'
        run=subprocess.run([sys.executable,str(Path(__file__).with_name('worker_probe.py'))],
          env=dict(os.environ,GENITHM_TEST_BUCKET=e['c'].storage.config.bucket),capture_output=True,text=True,timeout=600,check=True)
        assert e['api'].get('/api/v1/large-data/uploads/'+sid,headers=e['headers']).json()['state']=='ready'
    e['c'].rpc('pair_heartbeat',p_worker=str(uuid4()),p_storage=e['c'].storage.config.identity)
    job=submit(e,ids);assert job.status_code==202,job.text
    run=subprocess.run([sys.executable,str(Path(__file__).with_name('paired_worker_probe.py'))],
      env=dict(os.environ,GENITHM_TEST_BUCKET=e['c'].storage.config.bucket),capture_output=True,text=True,timeout=900,check=True)
    measured=json.loads(run.stdout.strip().splitlines()[-1]); row=status(e,job.json()['id']).json()
    assert row['state']=='ready',row
    result=row['result'];assert result['matched_pairs']==result['both_mate_annotations_checked']==count
    assert result['identifier_order_only_pairs']==0
    for i,digest in enumerate(hashes,1):
        actual=result[f'r{i}'];assert actual['sha256']==digest.hexdigest() and actual['source_bytes']==size
        m=actual['metrics'];assert m['read_count']==count and m['base_count']==count*100 and m['gc_percent']==50
        assert m['q30_bases']==(count*50 if i==1 else 0) and m['mean_phred']==(21 if i==1 else 20)
    assert measured['peak_worker_rss_kib']<300*1024
    out=Path(os.getenv('GENITHM_LARGE_DATA_EVIDENCE_DIR','artifacts/large-data'));out.mkdir(parents=True,exist_ok=True)
    evidence={'source_bytes_each':size,'physically_allocated':True,'matched_pairs':count,'source_sha256':[h.hexdigest() for h in hashes],
      'end_to_end_seconds_excluding_generation':time.perf_counter()-started,**measured,'result':result,'result_sha256':row['result_sha256'],
      'scope':'Isolated PostgreSQL and actual S3-compatible storage on a Linux CI runner; authentication is a fixture, not live-cloud or desktop-browser acceptance.'}
    (out/'paired-2x1gib-e2e.json').write_text(json.dumps(evidence,indent=2))
    for source in paths:source.unlink()
