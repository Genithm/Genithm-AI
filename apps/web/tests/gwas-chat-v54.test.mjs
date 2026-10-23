import test from "node:test";
import assert from "node:assert/strict";
import {isGwasExecutionRequest,gwasInputGuidance} from "../lib/gwas-chat-intent.ts";
import {readFileSync} from "node:fs";
const read=p=>readFileSync(new URL(p,import.meta.url),"utf8");
test("explicit GWAS execution requests point toward a real input-to-results workflow",()=>{
 for(const query of ["Run GWAS on my genotype and phenotype dataset", "Perform genome-wide association study",
    "start a GWAS", "GWAS", "Please analyze a genome-wide association study", "Do GWAS"])
   assert.equal(isGwasExecutionRequest(query),true,query);
});
test("educational and unrelated questions still reach the normal LLM",()=>{
 for(const query of ["Explain GWAS", "What is a genome-wide association study?", "Why can GWAS be confounded?",
   "Tell me about logistic regression", "Run BLAST", "Hello"])
   assert.equal(isGwasExecutionRequest(query),false,query);
});
test("GWAS guidance identifies actual file needs and never claims phantom science",()=>{
 const v=gwasInputGuidance();
 for(const token of ["/dashboard/gwas","VCF","phenotype","Analyze","not","64 MiB"])
   assert.ok(v.toLowerCase().includes(token.toLowerCase()));
 assert.doesNotMatch(v,/completed your GWAS|association confirmed|genome-wide significant result obtained/i);
});
test("GWAS is offered in authenticated chat, not silently sent to science-plan RPC",()=>{
 const route=read("../app/api/ai/chat/route.ts");
 assert.match(route,/isGwasExecutionRequest/);assert.match(route,/gwasInputGuidance/);
 assert.ok(route.indexOf("isGwasExecutionRequest")<route.indexOf("const providerResult = await startStreamingChat"));
 const page=read("../app/dashboard/gwas/page.tsx");assert.match(page,/getClaims/);assert.match(page,/redirect\("\/login"\)/);
 const composer=read("../components/ai-chat-composer.tsx");assert.match(composer,/href="\/dashboard\/gwas"/);
 const worker=read("../app/dashboard/gwas/gwas.worker.ts");
 assert.doesNotMatch(worker,/fetch\(|SUPABASE_SECRET_KEY|service_role|openai|GEMINI_API_KEY|GROQ_API_KEY/);
});
