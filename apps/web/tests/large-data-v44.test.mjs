import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {StreamingSha256} from '../lib/streaming-sha256.ts';

const ref=b=>createHash('sha256').update(b).digest('hex');
test('incremental SHA-256 agrees with platform crypto over vectors and split boundaries',()=>{
 for(const length of [0,1,55,56,63,64,65,127,128,129,1024,65537,1024*1024]){
  const source=randomBytes(length);
  for(const chunk of [1,7,64,127,4096]){
   const hash=new StreamingSha256();
   for(let start=0;start<length;start+=chunk)hash.update(source.subarray(start,start+chunk));
   assert.equal(hash.hex(),ref(source),`${length}/${chunk}`);
  }
 }
 assert.equal(new StreamingSha256().update(Buffer.from('abc')).hex(),'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
test('SHA-256 rejects reuse after finalization',()=>{
 const hash=new StreamingSha256();hash.hex();
 assert.throws(()=>hash.hex());assert.throws(()=>hash.update(new Uint8Array(1)));
});
test('frontend bounded hashing, direct storage transfer and real session resume are wired',()=>{
 const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
 const panel=read('../app/dashboard/data/large-data-panel.tsx');
 const worker=read('../app/dashboard/data/large-data-hash.worker.ts');
 const page=read('../app/dashboard/data/page.tsx');
 assert.match(worker,/file\.slice\(start,start\+chunk\)\.arrayBuffer/);
 assert.doesNotMatch(worker,/file\.arrayBuffer\(\)/);
 assert.match(panel,/new Worker\(new URL/);
 assert.match(panel,/file!\.slice\(/);
 assert.match(panel,/session\.expected_sha256!==sha/);
 assert.match(panel,/Promise\.allSettled/);
 assert.match(panel,/credentials:"omit"/);
 assert.match(panel,/getSession\(\)/);
 assert.doesNotMatch(panel,/localStorage|sessionStorage|SECRET_KEY/);
 assert.match(page,/LargeDataPanel projects=/);
});

test('SHA-256 handles the 32-bit bit-length carry with bounded buffers',()=>{
 const block=Buffer.alloc(1024*1024,0x51);const h=new StreamingSha256();const reference=createHash('sha256');
 for(let n=0;n<513;n++){h.update(block);reference.update(block);}
 h.update(Buffer.from('tail'));reference.update(Buffer.from('tail'));
 assert.equal(h.hex(),reference.digest('hex'));
});
