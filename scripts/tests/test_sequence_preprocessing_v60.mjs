import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync,gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {writeFile,readFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fastqTrimFromChat,scanOpenReadingFrames,orfDiscoveryFromChat,translateCodons,analyzeSequenceProcessing} from '../chat_science_preprocess.mjs';
const buf=x=>Buffer.from(x,'utf8');
const hash=x=>createHash('sha256').update(x).digest('hex');
const sequence='ACGT'.repeat(16);
const read=(name,seq=sequence,quality='I'.repeat(seq.length),mate=1)=>`@${name}/${mate}\n${seq}\n+\n${quality}\n`;
const gene='ATG'+'GCT'.repeat(36)+'TAA';
const complement={A:'T',T:'A',G:'C',C:'G'};
const rev=x=>[...x].reverse().map(c=>complement[c]).join('');

test('whole-file single-end trimming preserves original reads and source hashes',()=>{
 const raw=buf(read('a')+read('b'));
 const result=fastqTrimFromChat({r1:raw});
 assert.equal(result.summary.kind,'fastq-trim');
 assert.equal(result.summary.initial_reads,2);assert.equal(result.summary.kept_reads,2);
 assert.equal(result.summary.retention_percent,100);
 assert.equal(gunzipSync(result.outputs['trimmed_R1.fastq.gz']).toString(),raw.toString());
 assert.equal(result.provenance.source_files.r1.sha256,hash(raw));
 assert.doesNotMatch(result.outputs['summary.json'],/@a\/1/);
 assert.match(result.outputs['METHODS.md'],/exact adapter/i);
});
test('conservative exact adapter clipping produces actual new FASTQ reads',()=>{
 const seq=sequence+'AGATCGGAAGAGCTTTTTTTTTT';
 const original=read('adapter',seq);
 const result=fastqTrimFromChat({r1:buf(original)});
 const output=gunzipSync(result.outputs['trimmed_R1.fastq.gz']).toString();
 assert.equal(output,read('adapter',sequence));
 assert.equal(result.summary.adapter_trimmed_reads,1);
 assert.equal(result.summary.adapter_bases_removed,seq.length-sequence.length);
 assert.equal(result.summary.bases_after,sequence.length);
});
test('Q20 sliding window clips low-quality tail without altering high-quality 5 prime bases',()=>{
 const r=read('low',sequence,'I'.repeat(50)+'!'.repeat(14));
 const result=fastqTrimFromChat({r1:buf(r)});
 const out=gunzipSync(result.outputs['trimmed_R1.fastq.gz']).toString().split('\n');
 assert.equal(out[1].length,52); // 50 high-Q + 2 low-Q: 2*40/4 meets Q20
 assert.equal(out[3].slice(0,50),'I'.repeat(50));
 assert.equal(result.summary.quality_trimmed_reads,1);
 assert.equal(result.summary.quality_bases_removed,12);
});
test('paired outputs remain synchronized, with both mates discarded if one fails',()=>{
 const r1=read('p1',sequence,'I'.repeat(64),1)+read('p2',sequence,'I'.repeat(64),1);
 const r2=read('p1',sequence,'I'.repeat(64),2)+read('p2',sequence,'!'.repeat(64),2);
 const result=fastqTrimFromChat({r1:gzipSync(buf(r1)),r2:gzipSync(buf(r2))});
 assert.equal(result.summary.initial_reads,2);assert.equal(result.summary.kept_reads,1);
 assert.equal(result.summary.discarded_reads,1);assert.equal(result.summary.read_pairs_kept,1);
 const x=gunzipSync(result.outputs['trimmed_R1.fastq.gz']).toString();
 const y=gunzipSync(result.outputs['trimmed_R2.fastq.gz']).toString();
 assert.match(x,/@p1\/1/);assert.match(y,/@p1\/2/);
 assert.doesNotMatch(x,/@p2/);assert.doesNotMatch(y,/@p2/);
 assert.match(result.outputs['post-trim-qc.tsv'],/R2\t1/);
});
test('malformed FASTQ, incorrect paired ordering and suspicious compression reject before outputs',()=>{
 assert.throws(()=>fastqTrimFromChat({r1:buf(read('r1')),r2:buf(read('wrong',sequence,undefined,2))}),/mate|identifiers/);
 assert.throws(()=>fastqTrimFromChat({r1:buf('@x\nACGT\n+\nIII\n')}),/quality lengths/);
 assert.throws(()=>fastqTrimFromChat({r1:Buffer.from([31,139,0,1,1])}),/Compressed/);
 assert.throws(()=>fastqTrimFromChat({r2:buf(read('only'))}),/R1\/R2/);
 assert.throws(()=>fastqTrimFromChat({r1:buf(read('a',sequence,'!'.repeat(64)))}),/No FASTQ reads/);
});
test('trim provenance never leaks user original read identifiers or raw sequences into assistant summary',()=>{
 const secretName='patient-private-genome-identifier';
 const result=fastqTrimFromChat({r1:buf(read(secretName))});
 assert.doesNotMatch(result.outputs['summary.json'],/patient-private/);
 assert.doesNotMatch(result.outputs['provenance.json'],/patient-private/);
 assert.match(gunzipSync(result.outputs['trimmed_R1.fastq.gz']).toString(),/patient-private/);
});
test('standard genetic code translates actual codons and rejects incomplete or ambiguous codons',()=>{
 assert.equal(translateCodons('ATGTGGGAATAG'),'MWE*');
 assert.equal(translateCodons('GCTGACCTG'),'ADL');
 assert.throws(()=>translateCodons('ATGT'),/complete/);
 assert.throws(()=>translateCodons('ATGNNN'),/complete/);
});
test('six-frame ORF scan reports exact positive-strand 1-based inclusive GFF coordinates',()=>{
 const content='>plus\n'+gene+'\n';
 const result=orfDiscoveryFromChat({fasta:buf(content)});
 assert.equal(result.summary.contigs,1);
 assert.equal(result.summary.plus_strand_orfs,1);
 assert.equal(result.summary.orfs,1);
 const line=result.outputs['orfs.tsv'].split('\n')[1].split('\t');
 assert.equal(line[2],'+');assert.equal(line[4],'1');assert.equal(+line[5],gene.length);
 assert.equal(+line[7],37);
 assert.match(result.outputs['proteins.faa'],/^>orf000001/);
 assert.match(result.outputs['proteins.faa'],/MA{36}/);
 assert.match(result.outputs['orfs.gff3'],/\tputative_ORF\t1\t114\t/);
 assert.equal(result.provenance.source_files.fasta.sha256,hash(buf(content)));
});
test('minus-strand ORF is discovered with correct reference genome orientation',()=>{
 const content='>minus\nGGG'+rev(gene)+'CCC\n';
 const result=scanOpenReadingFrames(content);
 const minus=result.results.filter(o=>o.strand==='-');
 assert.ok(minus.length>0);
 assert.equal(minus[0].start,4);
 assert.equal(minus[0].end,3+gene.length);
 assert.equal(minus[0].aa_length,37);
});
test('RNA is normalized U to T, codons across ambiguous nucleotides cannot make false ORFs',()=>{
 const rna=gene.replaceAll('T','U');
 assert.ok(scanOpenReadingFrames('>rna\n'+rna).stats.orfs>=1);
 const broken='ATG'+'GCT'.repeat(10)+'NNN'+'GCT'.repeat(40)+'TAA';
 assert.equal(scanOpenReadingFrames('>ambiguous\n'+broken).stats.orfs,0);
});
test('ORF no-hit results are accurately empty; never invent protein records',()=>{
 const result=orfDiscoveryFromChat({fasta:buf('>short\nATGGCATAA\n')});
 assert.equal(result.summary.orfs,0);
 assert.equal(result.outputs['proteins.faa'],'');
 assert.match(result.outputs['orfs.gff3'],/^##gff-version 3/);
});
test('unsafe and protein FASTA cannot be silently translated as nucleotides',()=>{
 assert.throws(()=>orfDiscoveryFromChat({fasta:buf('>prot\nMEKWVTFIS\n')}),/nucleotide FASTA/);
 assert.throws(()=>orfDiscoveryFromChat({fasta:buf('ACGT')}),/precedes/);
 assert.throws(()=>orfDiscoveryFromChat({fasta:buf('>dup\nATG\n>dup\nATG')}),/duplicate/);
 assert.throws(()=>orfDiscoveryFromChat({fasta:buf('>x\nACGT?')}),/nucleotide FASTA/);
 assert.throws(()=>analyzeSequenceProcessing('unknown',{fasta:buf('>x\nATG')}),/Unsupported/);
});
test('GFF and TSV file names are escaped safely; formula-looking sequence IDs are neutralized',()=>{
 const result=orfDiscoveryFromChat({fasta:buf('>=formula\n'+gene+'\n')});
 assert.match(result.outputs['orfs.tsv'],/'=formula/);
 assert.match(result.outputs['orfs.gff3'],/%3Dformula/);
 assert.doesNotMatch(result.outputs['summary.json'],/=formula/);
});
test('V60 source output only contains genuine computed reads/peptides and bounded provenance',()=>{
 const t=analyzeSequenceProcessing('fastq-trim',{r1:buf(read('fixture'))});
 assert.ok(t.outputs['trimmed_R1.fastq.gz'].length>15);
 assert.ok(t.outputs['read-retention.svg'].includes('<svg'));
 const o=analyzeSequenceProcessing('orf-scan',{fasta:buf('>x\n'+gene)});
 assert.ok(o.outputs['orfs.tsv'].length>120);
 assert.ok(o.outputs['orf-lengths.svg'].includes('<svg'));
 assert.deepEqual(Object.keys(o.provenance.source_files),['fasta']);
});

test('real command-line scientific worker emits hashed ZIP, trimmed FASTQ, and ORF GFF3/FASTA',async()=>{
 const root=await mkdtemp(join(tmpdir(),'genithm-v60-cli-'));
 try{
  const rootInput=join(root,'in'),rootOut=join(root,'out');
  await mkdir(rootInput);await mkdir(rootOut);
  await writeFile(join(rootInput,'r1.txt'),buf(read('cli1',sequence+'AGATCGGAAGAGCAAA')));
  const exe=join(new URL('..',import.meta.url).pathname,'chat_science_worker.mjs');
  let run=spawnSync(process.execPath,['--experimental-strip-types',exe,'--kind','fastq-trim','--inputs',rootInput,'--out',rootOut],{encoding:'utf8',timeout:30000});
  assert.equal(run.status,0,run.stderr);
  const manifest=JSON.parse(await readFile(join(rootOut,'result-manifest.json'),'utf8'));
  assert.equal(manifest.kind,'fastq-trim');
  assert.equal(manifest.summary.kept_reads,1);
  for(const [file,digest] of Object.entries(manifest.hashes)){
    assert.equal(hash(await readFile(join(rootOut,file))),digest,file);
  }
  assert.ok(gunzipSync(await readFile(join(rootOut,'trimmed_R1.fastq.gz'))).toString().includes(sequence));
  assert.ok((await readFile(join(rootOut,'complete-results.zip'))).length>50);
  await rm(rootInput,{recursive:true,force:true});await rm(rootOut,{recursive:true,force:true});
  await mkdir(rootInput);await mkdir(rootOut);
  await writeFile(join(rootInput,'fasta.txt'),buf('>real_like_reference\n'+gene+'\n'));
  run=spawnSync(process.execPath,['--experimental-strip-types',exe,'--kind','orf-scan','--inputs',rootInput,'--out',rootOut],{encoding:'utf8',timeout:30000});
  assert.equal(run.status,0,run.stderr);
  const report=JSON.parse(await readFile(join(rootOut,'summary.json'),'utf8'));
  assert.equal(report.orfs,1);
  assert.match(await readFile(join(rootOut,'proteins.faa'),'utf8'),/>orf000001/);
  assert.match(await readFile(join(rootOut,'orfs.gff3'),'utf8'),/##gff-version 3/);
  const zipped=await readFile(join(rootOut,'complete-results.zip'));
  assert.equal(zipped.readUInt32LE(0),0x04034b50);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('V60 chat controls expose only deliberate analyses and protected result URLs',async()=>{
 const fs=await import('node:fs/promises');
 const src=await fs.readFile(new URL('../../apps/web/lib/chat-science-client.ts',import.meta.url),'utf8');
 const runner=await fs.readFile(new URL('../../apps/web/lib/chat-science-runner.ts',import.meta.url),'utf8');
 const route=await fs.readFile(new URL('../../apps/web/app/api/ai/science-results/route.ts',import.meta.url),'utf8');
 const ui=await fs.readFile(new URL('../../apps/web/components/chat-science-artifacts.tsx',import.meta.url),'utf8');
 const worker=await fs.readFile(new URL('../chat_science_worker.mjs',import.meta.url),'utf8');
 assert.match(src,/wantsTrim/);assert.match(src,/wantsOrf/);
 assert.match(src,/kind:'fastq-trim'/);assert.match(src,/kind:'orf-scan'/);
 assert.match(runner,/ACCEPTED_MANIFEST_VERSIONS/);
 assert.match(runner,/genithm-chat-science\/1\.1\.0/);
 assert.match(runner,/trimmed_R1\.fastq\.gz/);
 assert.match(route,/approved_private_compute/);
 assert.match(route,/chatScienceAcceptsRoles/);
 assert.match(ui,/trimmed_R1\.fastq\.gz/);
 assert.match(ui,/orfs\.gff3/);
 assert.match(worker,/analyzeSequenceProcessing/);
 assert.doesNotMatch(worker,/process\.env\.(?:GEMINI_API_KEY|GROQ_API_KEY|SUPABASE_SECRET_KEY)/);
});

test('actual Genithm chat router sends explicit trim and ORF requests to correct real engines',async()=>{
 const {proposeChatScience}=await import('../../apps/web/lib/chat-science-client.ts');
 const mate=[{filename:'sample_R2.fq.gz',head:'',gzip:true,size:1000},
             {filename:'sample_R1.fq.gz',head:'',gzip:true,size:1000}];
 assert.deepEqual(proposeChatScience('Trim adapters from my paired reads',mate),
   {kind:'fastq-trim',roles:{r1:1,r2:0}});
 assert.deepEqual(proposeChatScience('Clean my reads',[mate[0]]),{kind:'fastq-trim',roles:{r1:0}});
 assert.deepEqual(proposeChatScience('Find all ORFs and translate proteins',
   [{filename:'reference.fna',head:'>NC_000001\nACGT',size:20}]),{kind:'orf-scan',roles:{fasta:0}});
 assert.equal(proposeChatScience('Run BLAST on this sequence',
   [{filename:'ref.fasta',head:'>s\nACGT',size:8}]),null);
 assert.equal(proposeChatScience('Perform FASTQ alignment to a genome',mate),null);
 assert.equal(proposeChatScience('Predict gene annotation from this protein',
   [{filename:'protein.faa',head:'>p\nMEKWVTFIS',size:14}]),null);
 assert.equal(proposeChatScience('What is an ORF?',
   [{filename:'example.fa',head:'>x\nACGT',size:10}]),null);
});
