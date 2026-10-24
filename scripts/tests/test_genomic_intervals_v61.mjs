import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {parseBed,parseGff3,genomicOverlapFromChat} from '../chat_genomic_intervals.mjs';
const B=s=>Buffer.from(s,'utf8');
const G=(...s)=>B('##gff-version 3\n'+s.join('\n')+'\n');
const F=(chr,start,end,type='gene',id='gene1')=>[chr,'source',type,start,end,'.','+','.','ID='+id].join('\t');
const run=(bed,...gff)=>genomicOverlapFromChat({bed:B(bed),gff3:G(...gff)});
test('correct BED 0-based versus GFF3 1-based ends and unique coverage',()=>{
 const r=run('chr1\t0\t1\nchr1\t10\t20\nchr1\t20\t21\nchr1\t30\t31\n',
  F('chr1',1,1),F('chr1',20,20,'CDS','c1'),F('chr1',21,21,'exon','e1'));
 assert.equal(r.summary.intersections,3);
 assert.equal(r.summary.bed_union_bp,13);
 assert.equal(r.summary.annotation_overlap_union_bp,3);
 assert.equal(r.summary.bed_intervals_with_annotations,3);
});
test('duplicate BED and nested features do not double-count covered bases',()=>{
 const r=run('chrX\t0\t100\nchrX\t0\t100\n',F('chrX',1,100),F('chrX',40,60,'exon','ex'));
 assert.equal(r.summary.intersections,4);
 assert.equal(r.summary.bed_union_bp,100);
 assert.equal(r.summary.annotation_overlap_union_bp,100);
 assert.equal(r.summary.bed_coverage_fraction,1);
});
test('assembly naming mismatches are not silently repaired',()=>{
 const r=run('chr1\t0\t20\n',F('1',1,20));
 assert.equal(r.summary.intersections,0);
 assert.equal(r.summary.matching_contigs,0);
});
test('gzip inputs are verified from original compressed bytes',()=>{
 const bed=gzipSync(B('chr1\t0\t10\n')),gff3=gzipSync(G(F('chr1',1,10)));
 const result=genomicOverlapFromChat({bed,gff3});
 assert.equal(result.summary.intersections,1);
 assert.equal(result.provenance.source_files.bed.sha256,createHash('sha256').update(bed).digest('hex'));
});
test('invalid coordinates, malformed GFF and decompression bombs fail closed',()=>{
 const g=G(F('chr1',1,10));
 for(const bed of ['chr1\t-1\t20\n','chr1\t2\t2\n','chr1\t2.2\t4\n','chr1 0 10\n'])
  assert.throws(()=>genomicOverlapFromChat({bed:B(bed),gff3:g}));
 assert.throws(()=>parseGff3(B(F('chr1',1,10))),/version/);
 assert.throws(()=>parseBed(Buffer.from([0,1,2])));
 assert.throws(()=>parseGff3(gzipSync(B('x'.repeat(8*1024*1024+100)))));
});
test('GFF3 trailing embedded FASTA sequence is not interpreted as features',()=>{
 assert.equal(parseGff3(B('##gff-version 3\n'+F('chr1',1,10)+'\n##FASTA\n>chr1\nACGT\n')).length,1);
});
test('spreadsheet formulas in untrusted GFF IDs are escaped',()=>{
 const r=run('chr1\t0\t8\n',F('chr1',1,8,'gene','=HYPERLINK(1)'));
 assert.match(r.outputs['interval-overlaps.tsv'],/\t'=HYPERLINK\(1\)\t/);
 assert.doesNotMatch(r.outputs['summary.json'],/HYPERLINK/);
});
test('interval index matches brute force for seeded multichromosome data',()=>{
 let seed=117;const rnd=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;};
 const bed=[],gff=[];
 for(let i=0;i<500;i++){const chr='chr'+(1+rnd(3)),s=rnd(2000);bed.push([chr,s,s+1+rnd(80)]);}
 for(let i=0;i<800;i++){const chr='chr'+(1+rnd(3)),s=rnd(2000);gff.push([chr,s,s+1+rnd(80)]);}
 const r=run(bed.map(x=>x.join('\t')).join('\n')+'\n',
  ...gff.map((x,i)=>F(x[0],x[1]+1,x[2],'gene','f'+i)));
 const expected=bed.reduce((v,b)=>v+gff.filter(f=>f[0]===b[0]&&b[1]<f[2]&&f[1]<b[2]).length,0);
 assert.equal(r.summary.intersections,expected);
 assert.ok(r.summary.annotation_overlap_union_bp<=r.summary.bed_union_bp);
});
test('bounded sparse regions are efficiently indexed',()=>{
 const bed=Array.from({length:3000},(_,i)=>'chr1\t'+i*1000+'\t'+(i*1000+10)).join('\n')+'\n';
 const gff=Array.from({length:3000},(_,i)=>F('chr1',i*1000+300,i*1000+320));
 const r=run(bed,...gff);
 assert.equal(r.summary.intersections,0);
});
test('new study kind is integrated into all authenticated chat boundaries',async()=>{
 const {readFile}=await import('node:fs/promises');
 const p=async x=>readFile(new URL('../../'+x,import.meta.url),'utf8');
 const [runner,api,client,worker,artifacts,intent]=await Promise.all([
  p('apps/web/lib/chat-science-runner.ts'),p('apps/web/app/api/ai/science-results/route.ts'),
  p('apps/web/lib/chat-science-client.ts'),p('scripts/chat_science_worker.mjs'),
  p('apps/web/components/chat-science-artifacts.tsx'),p('apps/web/lib/chat-science-intent.ts')]);
 for(const s of [runner,api,client,worker,artifacts,intent])assert.match(s,/genomic-overlap/);
 assert.match(api,/approved_private_compute/);
 assert.match(runner,/genithm-chat-science\/1\.2\.0/);
 assert.doesNotMatch(worker,/process\.env\.(?:GEMINI_API_KEY|GROQ_API_KEY|SUPABASE_SECRET_KEY)/);
 const {proposeChatScience}=await import('../../apps/web/lib/chat-science-client.ts');
 assert.deepEqual(proposeChatScience('Intersect these BED regions with gene features',[
  {filename:'annotations.gff3.gz',head:'',gzip:true,size:100},
  {filename:'peaks.bed',head:'chr1\t0\t100',size:50}]),
  {kind:'genomic-overlap',roles:{bed:1,gff3:0}});
 assert.equal(proposeChatScience('Explain BED file format',[{filename:'peaks.bed',head:'chr1\t0\t100',size:20}]),null);
});
