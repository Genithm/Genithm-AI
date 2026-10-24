import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {bamQualityControl,parseBam,decodeBgzf} from '../chat_bam_qc.mjs';

const i32=n=>{const b=Buffer.alloc(4);b.writeInt32LE(n);return b};
const u32=n=>{const b=Buffer.alloc(4);b.writeUInt32LE(n);return b};
const text=s=>Buffer.from(s,'utf8');
/** Construct real BGZF members, including the required BC block-size subfield. */
function bgzf(chunk){
 const ordinary=gzipSync(chunk,{level:6});
 const out=Buffer.concat([ordinary.subarray(0,10),Buffer.from([6,0,66,67,2,0,0,0]),ordinary.subarray(10)]);
 assert.ok(out.length<=65536);
 out[3]=4;out.writeUInt16LE(out.length-1,16);return out;
}
function compressedBam(binary,{eof=true,chunkSize=60000}={}){
 const chunks=[];for(let offset=0;offset<binary.length;offset+=chunkSize)chunks.push(bgzf(binary.subarray(offset,offset+chunkSize)));
 if(eof)chunks.push(bgzf(Buffer.alloc(0)));
 return Buffer.concat(chunks);
}
function cigar(...ops){return ops.map(([len,op])=>{const codes='MIDNSHP=X';return (len<<4)|codes.indexOf(op)});}
function alignment({ref=0,pos=0,name='readA',flag=0,mapq=60,ops=cigar([10,'M']),seqLen=10,qual=30,tag=Buffer.alloc(0),nextRef=-1,nextPos=-1,tlen=0}={}){
 const qname=text(name+'\0'),core=Buffer.alloc(32);core.writeInt32LE(ref,0);core.writeInt32LE(pos,4);
 core.writeUInt8(qname.length,8);core.writeUInt8(mapq,9);core.writeUInt16LE(0,10);
 core.writeUInt16LE(ops.length,12);core.writeUInt16LE(flag,14);core.writeInt32LE(seqLen,16);
 core.writeInt32LE(nextRef,20);core.writeInt32LE(nextPos,24);core.writeInt32LE(tlen,28);
 const opsBuf=Buffer.alloc(ops.length*4);ops.forEach((v,i)=>opsBuf.writeUInt32LE(v,i*4));
 const bases=Buffer.alloc(Math.ceil(seqLen/2),0x11),qualities=Buffer.alloc(seqLen,qual);
 const body=Buffer.concat([core,qname,opsBuf,bases,qualities,tag]);return Buffer.concat([i32(body.length),body]);
}
function construct(recs,{refs=[['chr1',200],['chr2',100]],header='@HD\tVN:1.6\n'}={}){
 const dictionary=refs.map(([name,len])=>Buffer.concat([i32(Buffer.byteLength(name)+1),text(name+'\0'),i32(len)]));
 return Buffer.concat([Buffer.from([66,65,77,1]),i32(Buffer.byteLength(header)),text(header),i32(refs.length),...dictionary,...recs]);
}
function fixture(recs,opts={}){return compressedBam(construct(recs,opts));}
function nm(n){const b=Buffer.alloc(7);b.write('NM',0,'ascii');b.write('i',2,'ascii');b.writeInt32LE(n,3);return b;}
function run(recs,opts={}){return bamQualityControl({bam:fixture(recs,opts)});}

test('real BGZF BAM primary, unmapped, secondary and supplementary counts and MAPQ unknown',()=>{
 const res=run([alignment({name:'first',tag:nm(2)}),alignment({flag:4,ref:-1,pos:-1,ops:[],seqLen:0}),
  alignment({flag:256,name:'first'}),alignment({flag:2048,name:'first',mapq:255}),
  alignment({name:'other',mapq:255,pos:20})]);
 assert.equal(res.summary.kind,'bam-qc');assert.equal(res.summary.alignment_records,5);
 assert.equal(res.summary.primary_mapped,2);assert.equal(res.summary.primary_unmapped,1);
 assert.equal(res.summary.secondary,1);assert.equal(res.summary.supplementary,1);
 assert.equal(res.summary.mapped_primary_mapq_unknown,1);
 assert.equal(res.summary.mapped_primary_mapq_mean,60);
 assert.equal(res.summary.nm_tagged_primary,1);assert.equal(res.summary.nm_edits_primary_total,2);
 assert.equal(res.summary.total_reference_covered_bases,20);
 assert.ok(res.outputs['bam-mapq.svg'].includes('BAM alignment'));
 assert.equal(Object.keys(res.outputs).length,7);
});
test('CIGAR skips D and N, unions overlapping M/= /X mapping coverage',()=>{
 const a=alignment({pos:0,seqLen:12,ops:cigar([5,'M'],[2,'D'],[3,'M'],[8,'N'],[4,'='])});
 const b=alignment({pos:4,seqLen:10,ops:cigar([10,'M'])});
 const r=run([a,b]);assert.equal(r.summary.primary_aligned_reference_bases,22);
 // [0,5) [7,10) [18,22) and [4,14) => union [0,14)+[18,22)=18
 assert.equal(r.summary.total_reference_covered_bases,18);
 assert.match(r.outputs['bam-cigar-operations.tsv'],/\nD\t2\n/);
 assert.match(r.outputs['bam-reference-coverage.tsv'],/chr1\t200\t2\t22\t18\t0\.090000/);
});
test('valid multi-member BGZF and verified compressed input SHA-256',()=>{
 const records=Array.from({length:300},(_,i)=>alignment({name:'r'+i,pos:i%100}));
 const bytes=construct(records),source=compressedBam(bytes,{chunkSize:2000});
 const z=decodeBgzf(source);assert.deepEqual(z.decoded,bytes);
 assert.ok(z.bgzfBlocks>5);assert.equal(z.eofMarkerPresent,true);
 const out=bamQualityControl({bam:source});assert.equal(out.summary.primary_mapped,300);
 assert.equal(out.provenance.source_files.bam.sha256,createHash('sha256').update(source).digest('hex'));
 assert.equal(out.summary.bgzf_members,z.bgzfBlocks);
});
test('genuine BAM reader never exports raw QNAME, base sequences or quality payload',()=>{
 const r=run([alignment({name:'SECRET-BIOLOGICAL-READ-71',seqLen:10,tag:nm(3)})]);
 for(const value of Object.values(r.outputs)){
  assert.doesNotMatch(String(value),/SECRET-BIOLOGICAL-READ-71/);
  assert.doesNotMatch(String(value),/read1\t0\tchr1\t1\t60/);
 }
 assert.equal(r.provenance.original_read_names_or_bases_exported,false);
});
test('accepts missing conventional BGZF EOF marker, reports limitation',()=>{
 const r=bamQualityControl({bam:compressedBam(construct([alignment()]),{eof:false})});
 assert.equal(r.summary.bgzf_eof_marker_present,false);
 assert.match(r.summary.warnings.join(' '),/EOF marker is missing/);
});
test('rejects ordinary gzip and invalid or corrupted BGZF member and CRC',()=>{
 const b=construct([alignment()]);
 assert.throws(()=>bamQualityControl({bam:gzipSync(b)}),/BGZF/);
 const good=compressedBam(b),bad=Buffer.from(good);bad[bad.length-32]^=255;
 assert.throws(()=>decodeBgzf(bad),/BGZF/);
 assert.throws(()=>decodeBgzf(good.subarray(0,good.length-3)),/BGZF/);
 const noBC=Buffer.from(good);noBC[12]=0;
 assert.throws(()=>decodeBgzf(noBC),/BC block/);
});
test('rejects mapped CIGAR sequence length mismatch',()=>{
 assert.throws(()=>run([alignment({ops:cigar([8,'M']),seqLen:10})]),/CIGAR query consumption/);
});
test('rejects coordinate positions extending beyond reference',()=>{
 assert.throws(()=>run([alignment({pos:195,ops:cigar([10,'M'])})]),/exceeds declared reference/);
});
test('rejects malformed BAM reference dictionary and truncated binary blocks',()=>{
 const b=construct([alignment()]);const corrupted=Buffer.from(b);corrupted[0]=0;
 assert.throws(()=>bamQualityControl({bam:compressedBam(corrupted)}),/magic/);
 const missing=Buffer.from(b);missing.writeInt32LE(1000000,4);
 assert.throws(()=>bamQualityControl({bam:compressedBam(missing)}),/header text/);
 assert.throws(()=>bamQualityControl({bam:compressedBam(b.subarray(0,b.length-1))}),/Truncated BAM alignment/);
});
test('rejects unsupported CIGAR opcode and high-quality byte',()=>{
 assert.throws(()=>run([alignment({ops:[(10<<4)|9]})]),/Unsupported BAM CIGAR/);
 assert.throws(()=>run([alignment({qual:200})]),/BAM quality/);
});
test('rejects long-CIGAR CG auxiliary tag rather than reporting placeholder metrics',()=>{
 const tag=Buffer.concat([text('CGBI'),i32(2),u32(160),u32(160)]);
 assert.throws(()=>run([alignment({tag})]),/long-CIGAR/);
});
test('rejects bad auxiliary tags, duplicate NM and partial unknown qualities',()=>{
 assert.throws(()=>run([alignment({tag:Buffer.from([78,77,105,1])})]),/Truncated/);
 assert.throws(()=>run([alignment({tag:Buffer.concat([nm(1),nm(2)])})]),/Duplicate/);
 const orig=construct([alignment()]);const b=Buffer.from(orig);const start=b.length-10;
 b[start+1]=255;
 assert.throws(()=>bamQualityControl({bam:compressedBam(b)}),/quality array mixes/);
});
test('rejects binary CRAM, non-BGZF and wrong role combinations',()=>{
 assert.throws(()=>bamQualityControl({bam:Buffer.from('CRAM')}),/BGZF/);
 assert.throws(()=>bamQualityControl({bam:fixture([alignment()]),sam:Buffer.from('foo')}),/exactly one/);
});
test('honors paired FLAG counting in real binary alignment fields',()=>{
 const r=run([alignment({flag:99,nextRef:0,nextPos:35,tlen:45}),
  alignment({flag:147,pos:35,nextRef:0,nextPos:0,tlen:-45})]);
 assert.equal(r.summary.paired_flagged,2);assert.equal(r.summary.proper_pair_flagged,2);
 assert.equal(r.summary.first_segment,1);assert.equal(r.summary.last_segment,1);
 assert.equal(r.summary.reverse_strand,1);
});
test('empty BAM alignment table fails, never claims completion',()=>{
 assert.throws(()=>bamQualityControl({bam:compressedBam(construct([]))}),/no alignment/);
});

test('V63 authenticated chat routing, consent, legacy manifest compatibility and verified download whitelist',async t=>{
 const fs=await import('node:fs/promises');
 const {fileURLToPath}=await import('node:url');
 const root=fileURLToPath(new URL('../../',import.meta.url));
 if(!(await fs.stat(root+'apps/web/lib/chat-science-client.ts').catch(()=>null))){t.skip('Full repository integration runs on GitHub Actions checkout.');return;}
 const read=p=>fs.readFile(root+p,'utf8');
 const [runner,route,worker,links,intent,client,prompt]=await Promise.all([
  read('apps/web/lib/chat-science-runner.ts'),read('apps/web/app/api/ai/science-results/route.ts'),
  read('scripts/chat_science_worker.mjs'),read('apps/web/components/chat-science-artifacts.tsx'),
  read('apps/web/lib/chat-science-intent.ts'),read('apps/web/lib/chat-science-client.ts'),
  read('apps/web/lib/genithm-ai-chat.ts')]);
 for(const s of [runner,route,worker,links,intent,client,prompt])assert.match(s,/bam-qc/);
 for(const file of ['bam-mapping-qc.tsv','bam-reference-coverage.tsv','bam-cigar-operations.tsv','bam-mapq.svg']){
  assert.ok(runner.includes(file)&&links.includes(file));
 }
 assert.match(route,/approved_private_compute/);
 assert.match(runner,/genithm-chat-science\/1\.4\.0/);
 assert.match(runner,/owner_hash/);assert.match(runner,/48\*3600\*1000/);
 assert.doesNotMatch(worker,/process\.env\.(?:GEMINI_API_KEY|GROQ_API_KEY|SUPABASE_SECRET_KEY)/);
 const {proposeChatScience}=await import('../../apps/web/lib/chat-science-client.ts');
 const file=[{filename:'sample.bam',head:'',gzip:true,size:5000}];
 assert.deepEqual(proposeChatScience('Analyze mapping quality and CIGAR statistics for my BAM',file),{kind:'bam-qc',roles:{bam:0}});
 assert.deepEqual(proposeChatScience('How many reads are mapped in this BAM file?',file),{kind:'bam-qc',roles:{bam:0}});
 assert.equal(proposeChatScience('Please call variants from my BAM',file),null);
 assert.equal(proposeChatScience('What is a BAM file?',file),null);
 assert.equal(proposeChatScience('Align reads to the genome with this BAM',file),null);
 assert.equal(proposeChatScience('Analyze this BAM as SAM',[{filename:'patient.sam',head:'',size:5000}])?.kind,'sam-qc');
});

test('V63 isolated real binary worker returns signed-hash manifest and ZIP, without private QNAME',async t=>{
 const fs=await import('node:fs/promises');
 const {fileURLToPath}=await import('node:url');
 const {join}=await import('node:path');
 const {tmpdir}=await import('node:os');
 const {spawnSync}=await import('node:child_process');
 const root=fileURLToPath(new URL('../../',import.meta.url));
 const script=root+'scripts/chat_science_worker.mjs';
 if(!(await fs.stat(script).catch(()=>null))){t.skip('Actual isolated worker test requires full repo checkout.');return;}
 const temp=await fs.mkdtemp(join(tmpdir(),'genithm-bam-v63-')),input=join(temp,'input'),output=join(temp,'result');
 try{
  await fs.mkdir(input);await fs.mkdir(output);
  const raw=fixture([alignment({name:'VERY_PRIVATE_READ_LABEL',pos:3,tag:nm(2)}),alignment({flag:4,ref:-1,pos:-1,ops:[],seqLen:0})]);
  await fs.writeFile(join(input,'bam.txt'),raw);
  const proc=spawnSync(process.execPath,['--experimental-strip-types',script,'--kind','bam-qc','--inputs',input,'--out',output],
   {cwd:root,encoding:'utf8',timeout:30000});
  assert.equal(proc.status,0,proc.stderr);
  const manifest=JSON.parse(await fs.readFile(join(output,'result-manifest.json'),'utf8'));
  assert.equal(manifest.version,'genithm-chat-science/1.5.0');assert.equal(manifest.kind,'bam-qc');
  assert.equal(manifest.summary.primary_mapped,1);assert.equal(manifest.summary.primary_unmapped,1);
  for(const name of manifest.filenames){const bytes=await fs.readFile(join(output,name));
   assert.equal(createHash('sha256').update(bytes).digest('hex'),manifest.hashes[name]);
   if(name.endsWith('.tsv')||name.endsWith('.json')||name.endsWith('.md'))assert.doesNotMatch(bytes.toString('utf8'),/VERY_PRIVATE_READ_LABEL/);
  }
  const zip=await fs.readFile(join(output,'complete-results.zip'));
  assert.ok(zip.length>250&&zip.subarray(0,4).equals(Buffer.from([80,75,3,4])));
  const provenance=JSON.parse(await fs.readFile(join(output,'provenance.json'),'utf8'));
  assert.equal(provenance.source_files.bam.sha256,createHash('sha256').update(raw).digest('hex'));
 }finally{await fs.rm(temp,{recursive:true,force:true});}
});