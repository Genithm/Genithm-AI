import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {planBatch,sourcePath,pendingParts,transferFile} from '../lib/file-batch-transfer.ts';
const chunk=64*1024**2,sha='a'.repeat(64);
const file=(name='data.bam',size=10,path='')=>({name,size,webkitRelativePath:path,slice:(start,end)=>new Blob([String(start)+':'+end])});
const setup=(size=10)=>{
 const f=file('data.bam',size,'study/data.bam'),source=planBatch([f],10*1024**3)[0],batchId=randomUUID(),project=randomUUID();
 const row={id:randomUUID(),state:'uploading',expected_bytes:size,expected_sha256:sha,part_bytes:chunk,relative_path:source.path,batch_id:batchId,intake_mode:'auto',parts:[]};
 const calls=[],puts=[],updates=[],controller=new AbortController();
 const opts={project,batchId,source,mode:'auto',signal:controller.signal,hash:async()=>sha,progress:()=>{},session:r=>updates.push({...r}),
 api:async(path,body)=>{
  calls.push({path,body});
  if(path==='/files'||path==='/uploads/'+row.id)return {...row};
  if(path.endsWith('/complete'))return {...row,state:'uploaded'};
  if(path.includes('/parts/')){const n=Number(path.split('/').at(-1));return {url:'https://storage.invalid/'+n,bytes:Math.min(chunk,size-(n-1)*chunk),headers:{}};}
  throw Error('Unexpected API '+path);
 },put:async(url,request)=>{puts.push({url,request});return {ok:true};}};
 return {opts,row,calls,puts,updates,controller};
};

test('all extensions and folder-relative paths are accepted without file bytes or requests',()=>{
 const sources=planBatch(['a.bam','b.cram','c.h5ad','d.mzML','e.pdb','f.tar.gz','g.RDS','h.newextension','noextension'].map(name=>file(name,10,'root/'+name)),100);
 assert.equal(sources.length,9);assert.equal(new Set(sources.map(x=>x.requestId)).size,9);
 assert.equal(sourcePath(file('.zarray',10,'sample.zarr/.zarray')),'sample.zarr/.zarray');
 for(const name of ['../x','/x','a\\b','a:b','.','..',' x','x\n','x\u202e'])assert.throws(()=>sourcePath(file(name)));
 for(const path of ['../x','a/../x','/x','a//x','a/x/','wrong'])assert.throws(()=>sourcePath(file('x',10,path)));
 assert.throws(()=>planBatch([file('x',0)],100));assert.throws(()=>planBatch([file('x',101)],100));
 assert.throws(()=>planBatch([file('x'),file('x')],100));
 assert.throws(()=>planBatch(Array.from({length:101},(_,i)=>file(String(i))),100));
});

test('provider-confirmed part geometry rejects duplicates and forged receipts',()=>{
 const f=file('x',chunk+7),s={part_bytes:chunk,parts:[{number:1,size:chunk}]};
 assert.deepEqual(pendingParts(f,s),{chunk,confirmed:chunk,numbers:[2]});
 for(const parts of [[{number:1,size:1}],[{number:0,size:chunk}],[{number:3,size:chunk}],[{number:1,size:chunk},{number:1,size:chunk}]])assert.throws(()=>pendingParts(f,{...s,parts}));
 assert.throws(()=>pendingParts(f,{...s,part_bytes:1}));
});

test('sequential source transfer preserves metadata, waits for PUTs and separates upload from scientific completion',async()=>{
 const e=setup(chunk+1);let active=0,peak=0,finished=0;
 e.opts.put=async(url,request)=>{active++;peak=Math.max(peak,active);assert.equal(request.credentials,'omit');assert.equal(request.referrerPolicy,'no-referrer');await new Promise(r=>setTimeout(r,5));active--;finished++;return {ok:true};};
 const api=e.opts.api;e.opts.api=async(path,body)=>{if(path.endsWith('/complete'))assert.equal(finished,2);return api(path,body);};
 const result=await transferFile(e.opts);assert.equal(result.state,'uploaded');assert.equal(peak,2);
 const b=e.calls[0].body;assert.equal(b.relative_path,'study/data.bam');assert.equal(b.batch_id,e.opts.batchId);assert.equal(b.mode,'auto');assert.ok(!('data_format' in b));
});

test('lost completion response resumes same source without re-uploading confirmed parts',async()=>{
 const e=setup(chunk+5),api=e.opts.api;let first=true;
 e.opts.api=async(path,b)=>{if(path.endsWith('/complete')&&first){first=false;e.row.state='uploaded';throw Error('lost response');}return api(path,b);};
 await assert.rejects(transferFile(e.opts),/lost response/);
 e.opts.source.uploadId=e.row.id;
 assert.equal((await transferFile(e.opts)).state,'uploaded');assert.equal(e.puts.length,2);
 assert.equal(e.calls.filter(c=>c.path==='/files').length,1);
});

test('retry without known upload ID keeps original idempotency request key',async()=>{
 const e=setup(),api=e.opts.api;let first=true;
 e.opts.api=async(path,b)=>{const r=await api(path,b);if(path==='/files'&&first){first=false;throw Error('lost reservation response');}return r;};
 await assert.rejects(transferFile(e.opts),/lost reservation/);await transferFile(e.opts);
 const reservations=e.calls.filter(c=>c.path==='/files');assert.equal(reservations[0].body.request_id,reservations[1].body.request_id);
});

test('resuming reuses confirmed parts rather than trusting client progress',async()=>{
 const e=setup(chunk*3+1);e.row.parts=[{number:1,size:chunk},{number:3,size:chunk}];e.opts.source.uploadId=e.row.id;
 await transferFile(e.opts);assert.deepEqual(e.puts.map(p=>p.url.split('/').at(-1)).sort(),['2','4']);
 assert.ok(!e.calls.some(c=>c.path==='/files'));
});

test('pause while metadata is in flight keeps server identity but sends no bytes',async()=>{
 const e=setup(),api=e.opts.api;e.opts.api=async(path,b)=>{const r=await api(path,b);e.controller.abort();return r;};
 await assert.rejects(transferFile(e.opts),{name:'AbortError'});assert.equal(e.updates[0].id,e.row.id);assert.equal(e.puts.length,0);
});

test('one failed PUT cancels its peer and never finalizes',async()=>{
 const e=setup(chunk*3);let peerAborted=false;
 e.opts.put=async(url,{signal})=>{
  if(url.endsWith('/1')){await new Promise(r=>setTimeout(r,5));return {ok:false};}
  return new Promise((_,reject)=>{signal.addEventListener('abort',()=>{peerAborted=true;reject(new DOMException('stopped','AbortError'));},{once:true});});
 };
 await assert.rejects(transferFile(e.opts),/Storage did not confirm/);assert.equal(peerAborted,true);assert.ok(!e.calls.some(c=>c.path.endsWith('/complete')));
});

test('changed source, scope, worker geometry or signed length sends no file data',async()=>{
 for(const change of [r=>r.expected_sha256='b'.repeat(64),r=>r.expected_bytes++,r=>r.relative_path='other',r=>r.batch_id=randomUUID(),r=>r.intake_mode='preserve',r=>r.part_bytes=1]){
  const e=setup();change(e.row);await assert.rejects(transferFile(e.opts));assert.equal(e.puts.length,0);
 }
 const e=setup(),api=e.opts.api;e.opts.api=async(p,b)=>p.includes('/parts/')?{url:'https://storage.invalid',bytes:9,headers:{}}:api(p,b);
 await assert.rejects(transferFile(e.opts),/Signed part length/);assert.equal(e.puts.length,0);
});

test('changed server ID on reconciliation cannot redirect file bytes',async()=>{
 const e=setup(),api=e.opts.api;e.opts.api=async(p,b)=>{const r=await api(p,b);return p==='/uploads/'+e.row.id?{...r,id:randomUUID()}:r;};
 await assert.rejects(transferFile(e.opts),/Upload state changed/);assert.equal(e.puts.length,0);
});

test('terminal rejection is not counted as a completed upload',async()=>{
 const e=setup();e.row.state='rejected';await assert.rejects(transferFile(e.opts),/Server state: rejected/);assert.equal(e.puts.length,0);
});

test('universal UI preserves opt-in, no extension filter, capability gate and user-controlled batch start',()=>{
 const text=readFileSync(new URL('../app/dashboard/data/universal-file-panel.tsx',import.meta.url),'utf8');
 assert.match(text,/open\?<BatchWorkspace/);assert.match(text,/webkitdirectory/);assert.match(text,/type="file" multiple/);
 assert.doesNotMatch(text,/accept=|localStorage|sessionStorage|setInterval|dangerouslySetInnerHTML/);
 assert.match(text,/file_uploads_version!==47/);assert.match(text,/file_verifier_ready/);assert.match(text,/onResume\(record.id\)/);
});
