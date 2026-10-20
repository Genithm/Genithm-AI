import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseVerifiedResearchFile,assertMatchingEvidence,loadVerifiedResearchFiles} from '../lib/verified-research-files.ts';
const pid='f0ad3605-32bc-4f22-ac43-497693233c0a';
const fid='814a4c27-9928-477e-8032-784c86f40e4f';
const digest='a'.repeat(64);
const base={record_id:fid,project_id:pid,report:{schema:'genithm-large-data-result/1',verification:'whole_object_sha256',source_sha256:digest,report_sha256:'b'.repeat(64),source_bytes:100,format:'opaque',scientific_scope:'bytes_only',metrics:null,intake:{inspection:'integrity_only'}}};
test('valid checked report describes only inert file bytes',()=>{
 const result=parseVerifiedResearchFile(base,fid,pid);
 assert.equal(result.scientific_scope,'bytes_only');
 assertMatchingEvidence([{...result,fastq:null,fasta:null}], [result]);
});
test('reject foreign record/project, forged digest and misrepresented biology',()=>{
 const clone=()=>structuredClone(base);
 assert.throws(()=>parseVerifiedResearchFile(base,'a4cff583-cf99-4f61-a972-32778493ce61',pid));
 assert.throws(()=>parseVerifiedResearchFile(base,fid,'bd02858c-04ba-443b-b9ad-56ae3ed99238'));
 let o=clone();o.report.report_sha256='bad';assert.throws(()=>parseVerifiedResearchFile(o,fid,pid));
 o=clone();o.report.scientific_scope='full_fastq_aggregate_qc';assert.throws(()=>parseVerifiedResearchFile(o,fid,pid));
 o=clone();o.report.scientific_scope='full_fasta_structural_summary';assert.throws(()=>parseVerifiedResearchFile(o,fid,pid));
 o=clone();o.report.metrics={read_count:42};assert.throws(()=>parseVerifiedResearchFile(o,fid,pid));
});
test('reject duplicate, missing, reordered and changed snapshot evidence',()=>{
 const result=parseVerifiedResearchFile(base,fid,pid);
 assert.throws(()=>assertMatchingEvidence([], [result]));
 assert.throws(()=>assertMatchingEvidence([{...result,report_sha256:'c'.repeat(64)}],[result]));
 assert.throws(()=>assertMatchingEvidence([{...result,fastq:{read_count:12},fasta:null}],[result]));
 assert.throws(()=>assertMatchingEvidence([{...result,fastq:null,fasta:null}],[result,result]));
});
test('fail closed on invalid IDs without contacting remote API',async()=>{
 await assert.rejects(loadVerifiedResearchFiles(['../../other'],pid,'fake',new AbortController().signal));
 await assert.rejects(loadVerifiedResearchFiles([fid,fid],pid,'fake',new AbortController().signal));
 await assert.rejects(loadVerifiedResearchFiles([fid],pid,'',new AbortController().signal));
});
test('fetches full verified report with bearer token and checks scope, but never raw file',async()=>{
 const old=globalThis.fetch;
 const oldEnv=process.env.NEXT_PUBLIC_GENITHM_API_URL;
 process.env.NEXT_PUBLIC_GENITHM_API_URL='http://localhost:8000';
 let seen=0;
 globalThis.fetch=async (url,options)=>{seen++;assert.match(url,new RegExp(fid));assert.equal(options.headers.Authorization,'Bearer userjwt');
   return new Response(JSON.stringify(base),{status:200,headers:{'Content-Type':'application/json'}});};
 try{const files=await loadVerifiedResearchFiles([fid],pid,'userjwt',new AbortController().signal);
   assert.equal(seen,1);assert.equal(files[0].source_bytes,100);
 }finally{globalThis.fetch=old;if(oldEnv===undefined)delete process.env.NEXT_PUBLIC_GENITHM_API_URL;else process.env.NEXT_PUBLIC_GENITHM_API_URL=oldEnv;}
});
