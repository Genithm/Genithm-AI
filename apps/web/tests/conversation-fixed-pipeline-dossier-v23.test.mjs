import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildConversationDossier, conversationDossierMarkdown } from "../lib/conversation-research-dossier.ts";

const a = "11111111-1111-4111-8111-111111111111";
const b = "22222222-2222-4222-8222-222222222222";
const c = "33333333-3333-4333-8333-333333333333";
const d = "44444444-4444-4444-8444-444444444444";
const e = "55555555-5555-4555-8555-555555555555";
const sha = "f".repeat(64);
const run = (status = "completed", overrides = {}) => ({
  id: a, template: "ncbi_nucleotide_orf_v1", status, requested_accession: "NM_000546.6",
  retrieval_id: b, sequence_upload_id: c, scientific_job_id: d, sequence_sha256: sha, ...overrides,
});
const completeRows = {
  fixedRetrievals: [{ id: b, status: "retrieved", resolved_accession: "NM_000546.6", source_database: "nucleotide" }],
  fixedSequences: [{ id: c, status: "ready", sha256: sha }],
  fixedScientificJobs: [{
    id: d, status: "completed", job_type: "sequence_insights", result_sha256: sha,
    result_object_path: "do-not-show/storage/key",
    result_summary: { operation: "orf_scan", orf_count: 3, raw_sequence: "SECRETATG",
      private_token: "PRIVATE_TOKEN" },
  }],
};
const make = (overrides = {}) =>
  buildConversationDossier({ conversationId: e, plans: [], fixedPipelines: [run()], ...completeRows, ...overrides });

test("V23 NCBI pipeline contributes one completed evidence-backed finding", () => {
  const dossier = make();
  assert.equal(dossier.status, "complete");
  assert.equal(dossier.counts.total, 1);
  assert.equal(dossier.counts.completed, 1);
  const f = dossier.findings[0];
  assert.equal(f.source, "fixed_pipeline");
  assert.equal(f.pipeline_id, a);
  assert.equal(f.plan_id, null);
  assert.equal(f.action, "NCBI nucleotide ORF scan");
  assert.equal(f.verified_download, "/dashboard/scientific-jobs/" + d + "/download");
  assert.equal(f.result_sha256, sha);
  assert.deepEqual(f.steps.map(x => x.state), ["completed","completed","completed"]);
  assert.deepEqual(f.metrics, [
    { label: "operation", value: "orf_scan" },
    { label: "orf count", value: "3" },
  ]);
  assert.doesNotMatch(JSON.stringify(dossier), /SECRETATG|PRIVATE_TOKEN|do-not-show/);
});

test("V23 never reports completion without matching FASTA, correct job and verified output", () => {
  const variants = [
    { fixedRetrievals: [] },
    { fixedRetrievals: [{ id:b, status:"retrieving" }] },
    { fixedSequences: [] },
    { fixedSequences: [{ id:c, status:"ready", sha256:"a".repeat(64) }] },
    { fixedScientificJobs: [] },
    { fixedScientificJobs: [{ id:d, status:"completed",job_type:"protein_properties",result_sha256:sha,result_object_path:"object" }] },
    { fixedScientificJobs: [{ id:d, status:"completed",job_type:"sequence_insights",result_sha256:"incorrect",result_object_path:"object" }] },
    { fixedScientificJobs: [{ id:d, status:"completed",job_type:"sequence_insights",result_sha256:sha,result_object_path:null }] },
  ];
  for (const variant of variants) {
    const value = make(variant);
    assert.equal(value.counts.completed, 0, JSON.stringify(variant));
    assert.equal(value.findings[0].state, "unknown");
    assert.equal(value.findings[0].verified_download, null);
    assert.equal(value.findings[0].result_sha256, null);
    assert.equal(value.findings[0].metrics.length, 0);
  }
});

test("V23 running and failed pipelines do not leak fabricated scientific findings", () => {
  const running = make({
    fixedPipelines: [run("awaiting_validation", { scientific_job_id: null })],
    fixedSequences: [{ id:c, status:"pending_validation", sha256:null }],
    fixedScientificJobs: [],
  });
  assert.equal(running.counts.running, 1);
  assert.equal(running.counts.completed, 0);
  assert.equal(running.findings[0].metrics.length, 0);
  const failure = make({
    fixedPipelines: [run("error")],
    fixedRetrievals: [{ id:b, status:"error" }],
  });
  assert.equal(failure.counts.failed, 1);
  assert.equal(failure.findings[0].verified_download, null);
});

test("V23 protein profile uses the appropriate scientific job type", () => {
  const value = make({
    fixedPipelines: [run("completed", { template: "ncbi_protein_profile_v1", requested_accession:"NP_000537.3" })],
    fixedScientificJobs: [{ id:d,status:"completed",job_type:"protein_properties",result_sha256:sha,
      result_object_path:"private/hidden",result_summary: { molecular_weight_da: 41862.4, api_secret:"NEVER" } }],
  });
  assert.equal(value.counts.completed, 1);
  assert.equal(value.findings[0].action, "NCBI protein profiling");
  assert.deepEqual(value.findings[0].metrics,[{label:"Molecular weight (Da)",value:"41862.4"}]);
  assert.equal(value.findings[0].verified_download,"/dashboard/scientific-jobs/"+d+"/download");
});

test("V23 ignores malformed or unsupported pipeline IDs/templates and deduplicates repeated run IDs", () => {
  const value=make({fixedPipelines:[run(),run(),run("completed",{id:"malformed"}),run("completed",{id:e,template:"unapproved_dynamic_dag"})]});
  assert.equal(value.counts.total,1);
  assert.equal(value.findings[0].pipeline_id,a);
});

test("V23 keeps traditional approved-plan findings alongside fixed protocols", () => {
  const value=make({plans:[{id:e,status:"ready",action_type:"blast",dispatched_resource_type:null,dispatched_resource_id:null}]});
  assert.equal(value.counts.total,2);
  assert.equal(value.counts.completed,1);
  assert.equal(value.counts.awaiting_approval,1);
  assert.deepEqual(value.findings.map(x=>x.source),["plan","fixed_pipeline"]);
});

test("V23 dossier exports contain allowlisted results and no internal source paths", () => {
  const value = make();
  const rendered = conversationDossierMarkdown(value);
  assert.match(rendered,/NCBI nucleotide ORF scan/);
  assert.match(rendered,/orf count: 3/);
  assert.match(rendered,/SHA-256: f{64}/);
  assert.doesNotMatch(rendered,/SECRETATG|PRIVATE_TOKEN|do-not-show/);
});

test("V23 conversation fetches all children under RLS and binds them only to chat-linked pipelines", () => {
  const page=readFileSync(new URL("../app/dashboard/ai/[id]/page.tsx",import.meta.url),"utf8");
  const module=readFileSync(new URL("../lib/conversation-research-dossier.ts",import.meta.url),"utf8");
  assert.match(page,/linkedPipelineIds/);
  assert.match(page,/fixedRetrievalIds/);
  assert.match(page,/fixedSequenceIds/);
  assert.match(page,/fixedScientificIds/);
  assert.match(page,/\.eq\("project_id", conversation\.project_id\)/);
  assert.match(page,/\.eq\("requested_by", claimsData\.claims\.sub\)/);
  assert.match(page,/\.eq\("created_by", claimsData\.claims\.sub\)/);
  assert.match(page,/fixedPipelines: linkedPipelines \?\? \[\]/);
  assert.match(page,/fixedScientificJobs: fixedScientificJobs \?\? \[\]/);
  assert.match(module,/const provenanceValid = Boolean\(/);
  assert.match(module,/sha\(sequence\.sha256\) === hash/);
  assert.match(module,/science\.job_type === expectedJob/);
});
