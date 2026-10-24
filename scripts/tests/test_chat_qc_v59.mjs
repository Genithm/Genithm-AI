import test from 'node:test';
import assert from 'node:assert/strict';
import { gunzipSync, gzipSync } from 'node:zlib';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
import {analyzeChatQc,parseFastaResearch,readQcText,CHAT_QC_VERSION} from '../chat_qc_engine.mjs';

const raw=s=>Buffer.from(s,'utf8');
const fq=(id,seq,qual,mate=1)=>`@${id}/${mate}\n${seq}\n+\n${qual}\n`;
const vcf='##fileformat=VCFv4.3\n#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tS1\n'+
 '1\t12\tv1\tA\tG\t45\tPASS\t.\tGT\t0/1\n'+
 '1\t21\tv2\tG\tT\t5\tq10\t.\tGT\t1/1\n'+
 '2\t31\tv3\tT\tTA\t30\tPASS\t.\tGT\t0/1\n';
const r1=fq('x','ACGTN','IIIII')+fq('y','GCAA','5555');
const r2=fq('x','TTTTN','IIIII',2)+fq('y','ACGT','5555',2);
function dig(b){return createHash('sha256').update(b).digest('hex');}

const expectedFiles=['summary.json','provenance.json','METHODS.md'];
function validateResult(out,kind,input){
 assert.equal(out.summary.kind,kind);assert.equal(out.provenance.kind,kind);
 assert.equal(out.provenance.engine,CHAT_QC_VERSION);
 assert.ok(out.summary.warnings.length>=2);
 for(const name of expectedFiles) assert.ok(typeof out.outputs[name]==='string' && out.outputs[name].length>20);
 for(const [role,bytes] of Object.entries(input))assert.equal(out.provenance.input_sha256[role].sha256,dig(bytes));
 assert.ok(!Object.values(out.outputs).some(x=>String(x).includes('@x/1')),'Raw read headers leaked into results');
}
test('single FASTQ QC computes exact Phred+33 and source fingerprints, not guesses',()=>{
 const input={r1:raw(r1)};const o=analyzeChatQc('fastq-qc',input);validateResult(o,'fastq-qc',input);
 assert.equal(o.summary.mode,'single');assert.equal(o.summary.reads,2);
 assert.equal(o.summary.bases,9);assert.equal(o.summary.q30_percent,55.56);
 assert.equal(o.summary.per_mate[0].mean_phred,31.111);
 assert.match(o.outputs['fastq-qc.tsv'],/R1\t2\t9/);
 assert.match(o.outputs['quality-by-cycle.svg'],/Read cycle/);
 assert.match(o.outputs['read-lengths.svg'],/FASTQ read-length/);
});
test('paired compressed FASTQ validates read IDs and mates and fully decompresses',()=>{
 const b1=gzipSync(raw(r1)),b2=gzipSync(raw(r2));
 const out=analyzeChatQc('fastq-qc',{r1:b1,r2:b2});
 assert.equal(out.summary.mode,'paired');assert.equal(out.summary.mates_validated,true);
 assert.equal(out.summary.read_pairs,2);assert.equal(out.summary.reads,4);
 assert.equal(out.provenance.input_sha256.r1.sha256,dig(b1));
 assert.equal(out.provenance.input_sha256.r2.sha256,dig(b2));
 assert.equal(out.summary.per_mate[1].q30_bases,5);
});
test('FASTQ QC rejects mismatched mates, incomplete read blocks, corrupt gzip and decompression bombs',()=>{
 assert.throws(()=>analyzeChatQc('fastq-qc',{r1:raw(r1),r2:raw(r2.replace('@y/2','@wrong/2'))}),/mate order|identifiers/);
 assert.throws(()=>analyzeChatQc('fastq-qc',{r1:raw('@x\nACGT\n+\n!!!\n')}),/complete 4-line|lengths differ/);
 assert.throws(()=>analyzeChatQc('fastq-qc',{r1:Buffer.from([31,139,0,0,0])}),/Compressed scientific input/);
 assert.throws(()=>readQcText(gzipSync(raw('A'.repeat(2*1024*1024))),10*1024),/expands beyond/);
 assert.throws(()=>analyzeChatQc('fastq-qc',{r2:raw(r2)}),/R1/);
});
test('VCF QC counts variants, Ti/Tv, sample columns and FILTER without reading genotypes',()=>{
 const input={vcf:raw(vcf)},o=analyzeChatQc('vcf-qc',input);validateResult(o,'vcf-qc',input);
 assert.equal(o.summary.variants,3);assert.equal(o.summary.samples,1);
 assert.equal(o.summary.variants_by_type.SNV,2);assert.equal(o.summary.variants_by_type.insertion,1);
 assert.equal(o.summary.ti_tv,1);
 assert.equal(o.summary.filters.pass,2);assert.equal(o.summary.filters.filtered,1);
 assert.match(o.outputs['vcf-qc.tsv'],/Ti\/Tv\t1/);
 assert.match(o.outputs['variant-types.svg'],/VCF record categories/);
 assert.ok(!o.outputs['summary.json'].includes('S1'));
});
test('gzipped VCF has exact source SHA and rejects missing header or malformed variant',()=>{
 const gz=gzipSync(raw(vcf));const o=analyzeChatQc('vcf-qc',{vcf:gz});
 assert.equal(o.summary.variants,3);assert.equal(o.provenance.input_sha256.vcf.sha256,dig(gz));
 assert.throws(()=>analyzeChatQc('vcf-qc',{vcf:raw(vcf.slice(25))}),/fileformat|header/);
 assert.throws(()=>analyzeChatQc('vcf-qc',{vcf:raw(vcf.replace('\tA\tG\t45','\tX\tG\t45'))}),/VCF REF/);
 assert.throws(()=>analyzeChatQc('vcf-qc',{vcf:raw(r1)}),/fileformat/);
});
test('FASTA nucleic acid records calculate length-weighted N50/L50/N90 and GC',()=>{
 const input={fasta:raw('>contig001 description\nACGTACGT\n>contig002\nNNNN\n>contig003\nATAT\n')};
 const o=analyzeChatQc('fasta-qc',input);validateResult(o,'fasta-qc',input);
 assert.equal(o.summary.records,3);assert.equal(o.summary.total_residues,16);
 assert.equal(o.summary.longest_sequence,8);assert.equal(o.summary.shortest_sequence,4);
 assert.equal(o.summary.n50,8);assert.equal(o.summary.l50,1);
 assert.equal(o.summary.n90,4);assert.equal(o.summary.l90,3);
 assert.equal(o.summary.gc_percent,33.333);assert.equal(o.summary.n_bases,4);
 assert.match(o.outputs['fasta-stats.tsv'],/contig001\t8\t4\t0/);
 assert.match(o.outputs['sequence-lengths.svg'],/Longest FASTA sequences/);
});
test('FASTA protein mode computes genuine amino acid counts without fake GC percentage',()=>{
 const o=analyzeChatQc('fasta-qc',{fasta:raw('>prot1\nMEKWVTFIS\n>prot2\nACDEFGHIK\n')});
 assert.equal(o.summary.molecule_type,'protein');assert.equal(o.summary.records,2);
 assert.equal(o.summary.gc_percent,null);assert.equal(o.summary.amino_acid_counts.M,1);
 assert.equal(o.summary.amino_acid_counts.K,2);
 assert.equal(o.summary.total_residues,18);
});
test('FASTA accepts multirecord contigs, denies untrusted control chars, malformed data and oversize',()=>{
 assert.throws(()=>parseFastaResearch('ACGT'),/before its header/);
 assert.throws(()=>parseFastaResearch('>header\n'),/nonempty/);
 assert.throws(()=>parseFastaResearch('>header\nXYZ?'),/unsupported/);
 assert.throws(()=>parseFastaResearch('>header\nACGT\0ACGT'),/malformed/);
 assert.throws(()=>readQcText(raw('A'.repeat(103)),100),/exceeds/);
 assert.throws(()=>analyzeChatQc('fasta-qc',{fasta:raw(r1)}),/before its header/);
 assert.throws(()=>analyzeChatQc('bad',{fasta:raw('>x\nACGT\n')}),/Unrecognized/);
});
test('FASTA TSV output neutralizes spreadsheet formulas in user-supplied FASTA identifiers',()=>{
 const o=analyzeChatQc('fasta-qc',{fasta:raw('>=HYPERLINK(1)\nACGT\n>+evil\nACGT\n')});
 assert.match(o.outputs['fasta-stats.tsv'],/'=HYPERLINK/);
 assert.match(o.outputs['fasta-stats.tsv'],/'\+evil/);
 assert.doesNotMatch(o.outputs['summary.json'],/HYPERLINK/);
});
test('10k FASTQ reads and 5k VCF records execute within bounded local testing time',()=>{
 const lines=Array.from({length:10000},(_,i)=>fq('r'+i,'ACGT'.repeat(25),'I'.repeat(100))).join('');
 const start=performance.now();const o=analyzeChatQc('fastq-qc',{r1:raw(lines)});
 assert.equal(o.summary.reads,10000);
 const fqMs=performance.now()-start;
 const vc=vcf+Array.from({length:4997},(_,i)=>`2\t${100+i}\tx${i}\tA\tG\t40\tPASS\t.\tGT\t0/1\n`).join('');
 const vcStart=performance.now();const v=analyzeChatQc('vcf-qc',{vcf:raw(vc)});
 assert.equal(v.summary.variants,5000);
 const vcfMs=performance.now()-vcStart;
 console.log(`V59 local measurement: 10k FASTQ reads ${fqMs.toFixed(1)}ms; 5k VCF records ${vcfMs.toFixed(1)}ms`);
 assert.ok(fqMs<10000&&vcfMs<10000);
});
test('V59 integrates dedicated parsers and private chat result links only for real file formats',()=>{
 const client=readFileSync(new URL('../../apps/web/lib/chat-science-client.ts',import.meta.url),'utf8');
 const worker=readFileSync(new URL('../chat_science_worker.mjs',import.meta.url),'utf8');
 const runner=readFileSync(new URL('../../apps/web/lib/chat-science-runner.ts',import.meta.url),'utf8');
 const display=readFileSync(new URL('../../apps/web/components/chat-science-artifacts.tsx',import.meta.url),'utf8');
 assert.match(client,/fastq-qc/);assert.match(client,/vcf-qc/);assert.match(client,/fasta-qc/);
 assert.match(worker,/analyzeChatQc/);assert.match(runner,/fastq-qc/);assert.match(display,/quality-by-cycle\.svg/);
 assert.match(runner,/owner_hash/);assert.match(runner,/sha\(data\)/);
 assert.doesNotMatch(worker,/GEMINI_API_KEY|GROQ_API_KEY|SUPABASE_SECRET_KEY/);
});

test('V59 worker CLI writes verified manifests, plots, source provenance and private downloadable ZIP for each QC type',async()=>{
 const {runChatStudy,CHAT_SCIENCE_VERSION}=await import('../chat_science_worker.mjs');
 const {mkdtemp,readFile,rm}=await import('node:fs/promises');
 const {tmpdir}=await import('node:os');
 const {join}=await import('node:path');
 const {inflateRawSync}=await import('node:zlib');
 const base=await mkdtemp(join(tmpdir(),'genithm-v59-qc-'));
 try{
  const types=[['fastq-qc',{r1:raw(r1)},'fastq-qc.tsv'],
    ['vcf-qc',{vcf:gzipSync(raw(vcf))},'vcf-qc.tsv'],
    ['fasta-qc',{fasta:raw('>testA\nACGTACGT\n>testB\nNNNN\n')},'fasta-stats.tsv']];
  for(const [kind,inputs,main] of types){
   const dir=join(base,kind);
   const out=await runChatStudy({kind,inputs,outDirectory:dir,onProgress:()=>{}});
   assert.equal(out.summary.kind,kind);
   const manifest=JSON.parse(await readFile(join(dir,'result-manifest.json'),'utf8'));
   assert.equal(manifest.version,CHAT_SCIENCE_VERSION);
   assert.equal(manifest.summary.kind,kind);
   assert.ok(manifest.filenames.includes('complete-results.zip'));
   assert.ok(manifest.filenames.includes(main));
   assert.equal(out.provenance.input_sha256[Object.keys(inputs)[0]].sha256,dig(Object.values(inputs)[0]));
   for(const name of manifest.filenames){
     const bytes=await readFile(join(dir,name));
     assert.equal(dig(bytes),manifest.hashes[name]);
   }
   const zip=await readFile(join(dir,'complete-results.zip'));
   assert.equal(zip.readUInt32LE(0),0x04034b50);
   const nameLen=zip.readUInt16LE(26),len=zip.readUInt32LE(18);
   const first=zip.subarray(30+nameLen,30+nameLen+len);
   assert.ok(inflateRawSync(first).length>10);
  }
 }finally{await rm(base,{force:true,recursive:true});}
});

test('one-file QC dispatch, paired R1/R2 role ordering and scientific intent protection',async()=>{
 const {proposeChatScience}=await import('../../apps/web/lib/chat-science-client.ts');
 const one=[{filename:'input.fastq.gz',head:'',size:150,gzip:true}];
 assert.deepEqual(proposeChatScience('Run quality control on my sequencing reads',one),{kind:'fastq-qc',roles:{r1:0}});
 assert.deepEqual(proposeChatScience('Analyze VCF quality metrics',[{filename:'input.vcf',head:vcf.slice(0,300),size:vcf.length}]),{kind:'vcf-qc',roles:{vcf:0}});
 assert.deepEqual(proposeChatScience('Summarize sequence lengths and GC content',[{filename:'sample.fa',head:'>seq\nACGT\n',size:10}]),{kind:'fasta-qc',roles:{fasta:0}});
 const mates=[{filename:'S_R2.fastq.gz',head:'',size:500,gzip:true},{filename:'S_R1.fastq.gz',head:'',size:500,gzip:true}];
 assert.deepEqual(proposeChatScience('Run paired read QC',mates),{kind:'fastq-qc',roles:{r1:1,r2:0}});
 assert.match(proposeChatScience('Run FASTQ QC',mates.map(x=>({...x,filename:'reads.fastq.gz'}))).error,/R1 and R2/);
 assert.equal(proposeChatScience('Run BLAST on this sequence',[{filename:'sample.fa',head:'>seq\nACGT\n',size:10}]),null);
 assert.equal(proposeChatScience('Perform GWAS on this VCF',[{filename:'input.vcf',head:vcf.slice(0,300),size:vcf.length}]),null);
 assert.equal(proposeChatScience('Explain VCF',[{filename:'input.vcf',head:vcf.slice(0,300),size:vcf.length}]),null);
 assert.equal(proposeChatScience('Run unrelated task',[{filename:'notes.txt',head:'plain text',size:12}]),null);
});

test('generic delegated file analysis defaults to QC, while explicit V60 trimming runs the correct new engine',async()=>{
 const {proposeChatScience}=await import('../../apps/web/lib/chat-science-client.ts');
 const files=[{filename:'sample.fastq.gz',head:'',size:123,gzip:true}];
 assert.deepEqual(proposeChatScience('Run an analysis on this file',files),{kind:'fastq-qc',roles:{r1:0}});
 assert.equal(proposeChatScience('Quantify RNA-seq from this FASTQ',files),null);
 assert.deepEqual(proposeChatScience('Trim adapters from these reads',files),{kind:'fastq-trim',roles:{r1:0}});
 assert.equal(proposeChatScience('Run BLAST on this FASTA',[{filename:'sample.fa',head:'>a\nACGT\n',size:8}]),null);
});
