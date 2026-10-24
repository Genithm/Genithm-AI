import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { DATA_FILES, DATA_REVISION, createZip, runPublicRiceStudy, genomicInflationFactor } from '../public_rice_gwas.mjs';
import { isPublicRiceGwasRequest, riceGwasCompletionMessage } from '../../apps/web/lib/public-rice-gwas-intent.ts';

function synthetic() {
  const n=80,m=60;
  const variants=Array.from({length:m},(_,i)=>({chr:String(i%12+1),id:`id${i+1}`,pos:1000+i*200}));
  const pcs=Array.from({length:n},(_,i)=>[Math.sin(i*.21),Math.cos(i*.17),Math.sin(i*.11)]);
  const geno=Array.from({length:n},(_,i)=>Array.from({length:m},(_,j)=>{const x=(i*7+j*11+Math.floor(i/(3+(j%5))))%9;return x<3?0:x<6?1:2;}));
  const pheno='HybID\tNSFTVID\tPlant height\n'+Array.from({length:n},(_,i)=>`s${i+1}\t${i+1}\t${(60+7*geno[i][6]+2*pcs[i][0]-pcs[i][1]+Math.sin(i*3.3)*1.6).toFixed(5)}`).join('\n')+'\n';
  const pop='Metadata\nGSOR ID,IRGC ID,NSFTV.ID,Accession.Name,Country.of.origin,Latitude,Longitude,Sub-population,PC1,PC2,PC3,PC4\n'+Array.from({length:n},(_,i)=>`${i+1},a,${i+1},Rice${i+1},Somewhere,0,0,IND,${pcs[i].map(x=>x.toFixed(7)).join(',')},0`).join('\n')+'\n';
  const ped=Array.from({length:n},(_,i)=>['F'+i,String(i+1),'0','0','0','0',...geno[i].flatMap(v=>v===0?['A','A']:v===1?['A','C']:['C','C'])].join(' ')).join('\n')+'\n';
  const map=variants.map(v=>`${v.chr}\t${v.id}\t0\t${v.pos}`).join('\n')+'\n';
  return {'sativas413.ped':ped,'sativas413.map':map,'sativas413.pheno':pheno,'sativas413.csv':pop};
}

test('delegate real rice GWAS for explicit first-turn and authorized follow-ups',()=>{
 for(const p of ['Perform GWAS on rice, choose real public data and give me results','Run a rice GWAS','do genome-wide association study on Oryza sativa'])
  assert.equal(isPublicRiceGwasRequest(p),true,p);
 for(const p of ['Explain GWAS on rice','What is GWAS for rice?','Run GWAS on wheat','Find a rice reference gene'])
  assert.equal(isPublicRiceGwasRequest(p),false,p);
 const h=[{role:'user',content:'Perform GWAS on rice using genuine data'}];
 for(const p of ['i have not files of data you itself fetch any and use','i dont need a specific variety you pick itself any data','You choose everything'])
   assert.equal(isPublicRiceGwasRequest(p,h),true,p);
 assert.equal(isPublicRiceGwasRequest('You choose everything',[{role:'user',content:'Run GWAS on maize'}]),false);
 assert.equal(isPublicRiceGwasRequest('How do I fetch rice data',h),false);
 assert.equal(isPublicRiceGwasRequest('Run GWAS on rice drought tolerance'),false);
});
test('result messages reference actual verified artifacts, not invented results',()=>{
 const run='d3b99b93-b942-48fb-9710-0dd95a1f4a62';
 const message=riceGwasCompletionMessage(run,{trait:'Plant height',matched:70,markers_source:60,markers_tested:55,significant_bonferroni:2,genomic_inflation_lambda:5.47,top_markers:[{chr:'3',pos:100,id:'id1',p:.001,fdr:.08}]});
 assert.match(message,/published/);assert.match(message,/\[\[genithm_rice_gwas_run:/);assert.match(message,/55 of 60/);
 assert.match(message,/5\.47/);assert.match(message,/confounded|inflation/i);
});
test('ZIP generator produces valid independently decoded files and rejects directory traversal',()=>{
 const zip=createZip({'a.tsv':'header\n1\n','b.txt':'hello world'});
 assert.equal(zip.readUInt32LE(0),0x04034b50);
 const nameLen=zip.readUInt16LE(26),len=zip.readUInt32LE(18),offset=30+nameLen;
 assert.equal(inflateRawSync(zip.subarray(offset,offset+len)).toString(),'header\n1\n');
 assert.throws(()=>createZip({'../../danger.txt':'bad'}),/Unsafe archive/);
});
test('pinned official workshop source URLs and SHA identifiers remain immutable',()=>{
 assert.match(DATA_REVISION,/^[a-f0-9]{40}$/);
 assert.equal(Object.keys(DATA_FILES).length,4);
 for(const item of Object.values(DATA_FILES))assert.match(item.gitBlob,/^[a-f0-9]{40}$/);
});
test('full synthetic PED with matching real-shaped genotype/phenotype computes SNP associations and exports every artifact',async()=>{
 const root=await mkdtemp(join(tmpdir(),'genithm-v57-synthetic-'));const fixture=join(root,'source'),out=join(root,'out');
 try{
  await mkdir(fixture);for(const [name,contents] of Object.entries(synthetic()))await writeFile(join(fixture,name),contents);
  const report=await runPublicRiceStudy({outDirectory:out,fixtureDirectory:fixture,onProgress:()=>{}});
  assert.equal(report.provenance.snp_markers_in_source,60);
  assert.equal(report.provenance.samples_complete,80);
  const result=JSON.parse(await readFile(join(out,'summary.json'),'utf8'));
  assert.ok(result.markers_tested>=40,result.markers_tested);
  assert.equal(result.trait,'Plant height');
  assert.ok(result.genomic_inflation_lambda>0 && Number.isFinite(result.genomic_inflation_lambda));
  assert.equal(result.genomic_inflation_lambda,report.provenance.genomic_inflation_lambda);
  assert.match(await readFile(join(out,'README.md'),'utf8'),/Genomic inflation diagnostic/);
  assert.ok(result.top_markers.some(item=>item.id==='id7' && item.p<1e-6), 'The planted SNP must show a strong association even if another correlated marker ranks first');
  const tsv=await readFile(join(out,'association.tsv'),'utf8');
  assert.match(tsv,/# genotype_source_sha256=/);
  assert.match(tsv,/CHR\tPOS\tID\tN\tMAF/);
  const zip=await readFile(join(out,'rice-gwas-results.zip'));
  assert.ok(zip.length>500);assert.equal(zip.readUInt32LE(0),0x04034b50);
  for(const p of ['qq.svg','manhattan.svg','provenance.json','README.md'])assert.ok((await readFile(join(out,p))).length>100);
 }finally{await rm(root,{force:true,recursive:true});}
});
test('invalid genotype dimensions never yield fabricated success',async()=>{
 const root=await mkdtemp(join(tmpdir(),'genithm-v57-fail-'));const fixture=join(root,'source');
 try{
  await mkdir(fixture);const source=synthetic();source['sativas413.ped']=source['sativas413.ped'].replace('A A','A');
  for(const [name,contents] of Object.entries(source))await writeFile(join(fixture,name),contents);
  await assert.rejects(()=>runPublicRiceStudy({outDirectory:join(root,'out'),fixtureDirectory:fixture,onProgress:()=>{}}),/PED record/);
 }finally{await rm(root,{force:true,recursive:true});}
});

test('authenticated chat executes public rice science before generic GWAS upload guidance',async()=>{
 const route=await readFile(new URL('../../apps/web/app/api/ai/chat/route.ts',import.meta.url),'utf8');
 const page=await readFile(new URL('../../apps/web/app/dashboard/ai/[id]/page.tsx',import.meta.url),'utf8');
 const dl=await readFile(new URL('../../apps/web/app/api/ai/public-rice-gwas/route.ts',import.meta.url),'utf8');
 assert.ok(route.includes('isPublicRiceGwasRequest(row.user_message'));
 assert.ok(route.indexOf('isPublicRiceGwasRequest(row.user_message')<route.indexOf('if (isGwasExecutionRequest(row.user_message))'));
 assert.match(route,/executePublicRiceGwas\(userId/);
 assert.match(route,/finish_ai_chat_turn/);
 assert.match(page,/PublicRiceGwasArtifacts/);
 assert.match(dl,/getClaims/);
 assert.match(dl,/authenticatedRiceResult/);
});

test('scientific executor is bounded, allowlisted and never inherits private AI credentials',async()=>{
 const runner=await readFile(new URL('../../apps/web/lib/public-rice-gwas-runner.ts',import.meta.url),'utf8');
 assert.match(runner,/GENITHM_CODESPACES_PREVIEW/);
 assert.match(runner,/GENITHM_CODESPACES_PREVIEW === "1"/);
 assert.match(runner,/signal\.addEventListener\("abort"/);
 assert.match(runner,/authenticatedRiceResult/);
 assert.match(runner,/hashes\[fileName\] !== hash/);
 assert.match(runner,/env:\{PATH:/);
 assert.doesNotMatch(runner,/process\.env\.(?:SUPABASE_SECRET_KEY|GEMINI_API_KEY|GROQ_API_KEY)/);
});

test('genomic inflation factor is 1 at the theoretical chi-square(1) null median',()=>{
 assert.ok(Math.abs(genomicInflationFactor([0.5])-1)<0.0001);
 assert.ok(genomicInflationFactor([0.115])>5);
 assert.throws(()=>genomicInflationFactor([NaN]),/Invalid GWAS P values/);
});
