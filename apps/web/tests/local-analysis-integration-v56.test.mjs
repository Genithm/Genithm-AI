import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {matchLocalAnalysisRequest, localAnalysisGuidance} from '../lib/local-analysis-intent.ts';
const file=p=>readFileSync(new URL(p,import.meta.url),'utf8');
test('V56 explicit requests route to a real lab without pretending they were already run',()=>{
 for(const q of ['Run differential expression on my count matrix','Perform bulk RNA-seq analysis',
   'Analyze gene expression between control and treated groups','Differential expression'])
  assert.equal(matchLocalAnalysisRequest(q),'expression',q);
 for(const q of ['Run pathway enrichment','Run gene set enrichment on my RNA-seq hits',
   'Perform functional enrichment on my DE genes','ORA'])
  assert.equal(matchLocalAnalysisRequest(q),'pathway',q);
});
test('V56 questions and unrelated scientific requests still reach Gemini/Groq',()=>{
 for(const q of ['Explain differential expression','What is RNA-seq?','How does pathway enrichment work?',
   'Why is gene set enrichment important?','Run GWAS','Run BLAST','Find a protein structure','Hello'])
  assert.equal(matchLocalAnalysisRequest(q),null,q);
});
test('V56 guidance states actual inputs and the scientific limitations',()=>{
 const rna=localAnalysisGuidance('expression');
 assert.match(rna,/\/dashboard\/expression/);
 assert.match(rna,/raw integer gene-count/);
 assert.match(rna,/not DESeq2\/edgeR/);
 assert.match(rna,/does NOT quantify FASTQ/);
 assert.match(rna,/Nothing has been executed/);
 const ora=localAnalysisGuidance('pathway');
 assert.match(ora,/\/dashboard\/pathways/);
 assert.match(ora,/explicit background/);
 assert.match(ora,/hypergeometric/);
 assert.match(ora,/not performed the analysis/);
});
test('V56 execution entry points require auth, no server tool action and preserve GWAS routing',()=>{
 const route=file('../app/api/ai/chat/route.ts');
 assert.match(route,/matchLocalAnalysisRequest/);
 assert.match(route,/localAnalysisGuidance/);
 assert.ok(route.indexOf('isGwasExecutionRequest(row.user_message)')<route.indexOf('matchLocalAnalysisRequest(row.user_message)'));
 assert.ok(route.indexOf('matchLocalAnalysisRequest(row.user_message)')<route.indexOf('const providerResult = await startStreamingChat'));
 for(const path of ['../app/dashboard/expression/page.tsx','../app/dashboard/pathways/page.tsx']){
  const page=file(path);
  assert.match(page,/getClaims\(\)/);
  assert.match(page,/redirect\("\/login"\)/);
 }
 const registry=file('../../ai-worker/genithm_ai_worker/capability_registry.py');
 assert.match(registry,/ScientificCapability\("differential_expression", "transcriptomics".*"available", "local"\)/);
 assert.match(registry,/ScientificCapability\("pathway_analysis", "systems_networks".*"available", "local"\)/);
 assert.match(registry,/ScientificCapability\("rna_seq_quantification", "transcriptomics".*"planned", "planned"\)/);
});
test('V56 scientific workers never send raw input to API, AI or a remote database',()=>{
 for(const path of ['../app/dashboard/expression/expression.worker.ts','../app/dashboard/pathways/pathways.worker.ts']){
  const content=file(path);
  assert.doesNotMatch(content,/\bfetch\(|XMLHttpRequest|EventSource|GEMINI_API_KEY|GROQ_API_KEY|SUPABASE_SECRET_KEY|service_role|navigator\.sendBeacon/);
  assert.match(content,/SHA-256/);
  assert.match(content,/\.arrayBuffer\(\)/);
 }
 const catalog=file('../app/dashboard/apps/page.tsx');
 assert.match(catalog,/href:"\/dashboard\/expression"/);
 assert.match(catalog,/href:"\/dashboard\/pathways"/);
 const composer=file('../components/ai-chat-composer.tsx');
 assert.match(composer,/href="\/dashboard\/expression"/);
 assert.match(composer,/href="\/dashboard\/pathways"/);
});
