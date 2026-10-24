import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import { runChatStudy, calculateChatStudy, prepareAirway, fetchPublicAirway, AIRWAY_SOURCE } from '../chat_science_worker.mjs';
import {proposeChatScience} from '../../apps/web/lib/chat-science-client.ts';
import {shouldRunPublicAirway,scienceCompletionText} from '../../apps/web/lib/chat-science-intent.ts';
function countFixture(){
 const samples=['ctrl1','ctrl2','ctrl3','case1','case2','case3'];
 const design='sample_id,condition\n'+samples.map((s,i)=>s+','+(i<3?'control':'treated')).join('\n')+'\n';
 const counts='gene_id,'+samples.join(',')+'\n'+Array.from({length:90},(_,i)=>`gene${i+1},`+samples.map((_,j)=>i<30?100+j+(j>=3?60:0):100+i+j).join(',')).join('\n')+'\n';
 return {counts:Buffer.from(counts),design:Buffer.from(design)};
}
function pathwayFixture(){
 const background=Array.from({length:100},(_,i)=>`G${i+1}`);
 const selected=background.slice(0,12);
 const gmt='PathwayA\tdescription\t'+background.slice(0,9).join('\t')+'\n'+
   'PathwayB\tdescription\t'+background.slice(32,52).join('\t')+'\n';
 return {selected:Buffer.from(selected.join('\n')+'\n'),universe:Buffer.from(background.join('\n')+'\n'),gmt:Buffer.from(gmt)};
}
test('real count matrix -> signed outputs, provenance, volcano, PCA, and ZIP archive',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'genithm-v58-counts-'));
 try{
  const report=await runChatStudy({kind:'expression',inputs:countFixture(),outDirectory:dir});
  assert.equal(report.summary.kind,'expression');assert.equal(report.summary.samples,6);assert.equal(report.summary.genes_tested,90);
  assert.equal(report.summary.inputs,'user-provided');
  for(const name of ['expression.tsv','sample_qc.tsv','volcano.svg','sample-pca.svg','measured_genes.txt','significant_genes.txt','provenance.json','summary.json','complete-results.zip']){
    const b=await readFile(join(dir,name));assert.ok(b.length>0);
    assert.equal(createHash('sha256').update(b).digest('hex'),report.hashes[name]);
  }
  const measured=await readFile(join(dir,'measured_genes.txt'),'utf8');assert.equal(measured.trim().split('\n').length,91);
  const manifest=JSON.parse(await readFile(join(dir,'result-manifest.json'),'utf8'));assert.equal(manifest.filenames.length,report.files.length);
  const zip=await readFile(join(dir,'complete-results.zip'));assert.equal(zip.readUInt32LE(0),0x04034b50);
 }finally{await rm(dir,{force:true,recursive:true});}
});
test('real GMT overlap -> exact hypergeometric counts with complete result files',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'genithm-v58-pathway-'));
 try{const r=await runChatStudy({kind:'pathways',inputs:pathwayFixture(),outDirectory:dir});
  assert.equal(r.summary.selected,12);assert.equal(r.summary.universe,100);assert.equal(r.summary.pathways_tested,2);
  assert.ok(r.summary.top_pathways[0].p<0.0000001);
  const tsv=await readFile(join(dir,'pathway-enrichment.tsv'),'utf8');assert.match(tsv,/PathwayA/);assert.match(tsv,/PathwayB/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('reject wrong inputs rather than generating plausible-looking results',()=>{
 assert.throws(()=>calculateChatStudy('pathways',{selected:Buffer.from('G1'),gmt:Buffer.from('P\td\tG1')}),/requires/);
 assert.throws(()=>calculateChatStudy('expression',{...countFixture(),design:Buffer.from('sample_id,condition\nctrl1,control\n')}),/Exactly two|sample/);
});
test('airway public conversion preserves 8 metadata groups and never invents gene counts',()=>{
 const meta='id,dex,celltype,geo_id\n'+Array.from({length:8},(_,i)=>`SRR${i+1},${i%2?'treated':'control'},D,GSM${i+1}`).join('\n')+'\n';
 const counts='ensgene,'+Array.from({length:8},(_,i)=>`SRR${i+1}`).join(',')+'\n'+
   Array.from({length:22},(_,i)=>`G${i+1},`+Array(8).fill(i+10).join(',')).join('\n')+'\n';
 const prepared=prepareAirway(counts,meta);assert.match(prepared.countsText,/^gene_id,SRR1,/);
 assert.equal(prepared.designText.split('\n').filter(Boolean).length,9);
 assert.match(prepared.designText,/SRR2,treated/);
});
test('airway public source pinning refuses mismatched bytes',async()=>{
 const fake=async url=>({ok:true,url,headers:new Headers({'content-length':'100'}),arrayBuffer:async()=>new Uint8Array(100).buffer});
 await assert.rejects(()=>fetchPublicAirway(fake),/Unexpected public airway source size/);
 assert.match(AIRWAY_SOURCE.revision,/^[a-f0-9]{40}$/);
});
test('execution intent: public RNA automatically selected only for matching goals',()=>{
 for(const msg of ['Run differential expression', 'Perform RNA-seq, choose real data yourself', 'Research gene expression on available public human data'])
  assert.equal(shouldRunPublicAirway(msg),true,msg);
 for(const msg of ['What is RNA-seq?','Run rice RNA-seq','Perform single-cell RNA-seq','Analyze my attached fastq files','Run GWAS on rice','Analyze my uploaded RNA count matrix'])
  assert.equal(shouldRunPublicAirway(msg),false,msg);
 const hist=[{role:'user',content:'Please run differential expression of a real published dataset'}];
 assert.equal(shouldRunPublicAirway('I have no files, pick the public data',hist),true);
 assert.equal(shouldRunPublicAirway('Pick data',[{role:'user',content:'Run GWAS on rice'}]),false);
});
test('user-provided source inference for VCF+phenotype, counts+design, GMT+gene lists',()=>{
 const gwas=proposeChatScience('Run GWAS',[
 {filename:'rice.vcf',head:'##fileformat=VCFv4.2\n#CHROM\tPOS\tID',size:90000},
 {filename:'trait.tsv',head:'sample_id\tphenotype\nA\t12',size:1000}]);
 assert.deepEqual(gwas?.roles,{genotypes:0,phenotypes:1});
 const expr=proposeChatScience('Run differential expression',[
 {filename:'design.csv',head:'sample_id,condition\nA,control',size:100},
 {filename:'counts.csv',head:'gene_id,A,B,C,D,E,F\nG,2,3,4,5,6,7',size:200}]);
 assert.deepEqual(expr?.roles,{counts:1,design:0});
 const pathways=proposeChatScience('Perform pathway enrichment',[
 {filename:'measured_universe.txt',head:'G1\nG2\nG3',size:300},
 {filename:'my_pathways.gmt',head:'Set1\tDescription\tG1\tG2',size:90},
 {filename:'selected_genes.txt',head:'G1\nG2',size:25}]);
 assert.deepEqual(pathways?.roles,{gmt:1,selected:2,universe:0});
 assert.equal(proposeChatScience('Explain these data',[{filename:'a.csv',head:'a,b',size:2},{filename:'b.csv',head:'a,b',size:3}]),null);
});
test('chat outputs are honest about exploratory inference, show a verifiable run marker',()=>{
 const note=scienceCompletionText('a071b3a4-2ba5-49ef-a97a-93c10e93adf0',{
  kind:'expression',method:'Welch t on CPM',inputs:'user-provided',samples:8,genes_tested:4000,genes_seen:4500,genes_fdr_below_0_05:200,
  warnings:['Not a negative-binomial model.']});
 assert.match(note,/Original file bytes/);assert.match(note,/\[\[genithm_science_run:expression:/);assert.match(note,/negative-binomial/);
});
test('synthetic matching VCF/dosage and phenotype are computed by GWAS engine (no model fabrication)',async()=>{
 const n=48,v=60,samples=Array.from({length:n},(_,i)=>`S${i+1}`);
 const dosages=Array.from({length:v},(_,j)=>samples.map((_,i)=>((i*7+j*13+Math.floor(i/(3+j%4)))%9<3?0:(i*7+j*13+Math.floor(i/(3+j%4)))%9<6?1:2)));
 const geno='CHR\tPOS\tSNP\t'+samples.join('\t')+'\n'+dosages.map((values,j)=>`1\t${1000+j*90}\trs${j+1}\t`+values.join('\t')).join('\n')+'\n';
 const trait=samples.map((s,i)=>`\n${s}\t${(100+dosages[12][i]*3.4+Math.sin(i*2.1)).toFixed(7)}`).join('');
 const phenotype='sample_id\tphenotype'+trait+'\n';
 const dir=await mkdtemp(join(tmpdir(),'genithm-v58-gwas-'));
 try{
  const study=await runChatStudy({kind:'gwas',inputs:{genotypes:Buffer.from(geno),phenotypes:Buffer.from(phenotype)},outDirectory:dir});
  assert.equal(study.summary.samples,n);assert.ok(study.summary.variants_tested>=45);
  assert.ok(study.summary.top_associations.length>=1);
  const assoc=await readFile(join(dir,'association.tsv'),'utf8');
  assert.match(assoc,/rs13/);assert.match(assoc,/P_BONFERRONI/);
  assert.match(await readFile(join(dir,'manhattan.svg'),'utf8'),/measured variants/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('chat integration dispatch is separate from LLM and enforces private-file consent',async()=>{
 const root=new URL('../../',import.meta.url);
 const fs=await import('node:fs/promises');
 const read=async path=>fs.readFile(new URL(path,root),'utf8');
 const chat=await read('apps/web/app/api/ai/chat/route.ts');
 const upload=await read('apps/web/app/api/ai/science-results/route.ts');
 const compose=await read('apps/web/components/ai-chat-composer.tsx');
 const result=await read('apps/web/components/chat-science-artifacts.tsx');
 const runner=await read('apps/web/lib/chat-science-runner.ts');
 assert.match(chat,/getChatScienceRun\(userId, projectId, completedScienceRunId\)/);
 assert.match(chat,/shouldRunPublicAirway\(row\.user_message/);
 assert.match(chat,/scienceCompletionText/);
 assert.match(upload,/db\.auth\.getClaims\(\)/);
 assert.match(upload,/\.from\('projects'\)\.select\('id'\)\.eq\('id',projectId\)/);
 assert.match(upload,/approved_private_compute/);
 assert.match(compose,/identifyChatScienceFiles\(trimmed/);
 assert.match(compose,/if \(!approvePrivateCompute\)/);
 assert.match(result,/api\/ai\/science-results\?run=/);
 assert.match(runner,/authenticated|owner_hash/);
 assert.match(runner,/chatScienceAvailable\(\)/);
 assert.doesNotMatch(runner,/process\.env\.(?:GEMINI_API_KEY|GROQ_API_KEY|SUPABASE_SECRET_KEY)/);
});
