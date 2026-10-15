import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildConversationDossier, conversationDossierMarkdown } from "../lib/conversation-research-dossier.ts";

const a = "11111111-1111-4111-8111-111111111111";
const b = "22222222-2222-4222-8222-222222222222";
const c = "33333333-3333-4333-8333-333333333333";
const d = "44444444-4444-4444-8444-444444444444";
const e = "55555555-5555-4555-8555-555555555555";
const h = "f".repeat(64);
const plan = (id, status, action, type = null, resourceId = null) =>
  ({ id, status, action_type: action, dispatched_resource_type: type, dispatched_resource_id: resourceId });
const dossier = (data = {}) => buildConversationDossier({ conversationId: a, plans: [], ...data });

test("an empty conversation contains no fictional scientific results", () => {
  const value = dossier();
  assert.equal(value.status, "empty");
  assert.equal(value.findings.length, 0);
});

test("ready actions require owner approval and running BLAST has no displayed results", () => {
  const value = dossier({
    plans: [plan(a, "ready", "blast"), plan(b, "dispatched", "blast", "blast_job", c)],
    blastJobs: [{ id: c, status: "running", result_summary: { hit_count: 42, secret: "DO_NOT_DISPLAY" } }],
  });
  assert.equal(value.counts.awaiting_approval, 1);
  assert.equal(value.counts.running, 1);
  assert.equal(value.counts.completed, 0);
  assert.equal(value.findings[1].metrics.length, 0);
  assert.ok(!JSON.stringify(value).includes("DO_NOT_DISPLAY"));
});

test("finished scientific jobs expose allowlisted facts and verified download only", () => {
  const value = dossier({
    plans: [plan(a, "dispatched", "sequence_insights", "scientific_job", b)],
    scientificJobs: [{
      id: b, status: "completed", result_sha256: h,
      result_object_path: "sensitive/internal/object/key",
      result_summary: { operation: "orf_scan", orf_count: 2, raw_sequence: "ATGAAATAA", service_key: "secret" },
    }],
  });
  assert.equal(value.status, "complete");
  assert.equal(value.findings[0].result_sha256, h);
  assert.equal(value.findings[0].verified_download, "/dashboard/scientific-jobs/" + b + "/download");
  assert.deepEqual(value.findings[0].metrics, [
    { label: "operation", value: "orf_scan" },
    { label: "orf count", value: "2" },
  ]);
  assert.ok(!JSON.stringify(value).includes("ATGAAATAA"));
  assert.ok(!JSON.stringify(value).includes("sensitive/internal"));
});

test("completed status with invalid recorded SHA never creates a raw download link", () => {
  const value = dossier({
    plans: [plan(a, "dispatched", "protein_properties", "scientific_job", b)],
    scientificJobs: [{ id: b, status: "completed", result_sha256: "not-sha", result_object_path: "private" }],
  });
  assert.equal(value.findings[0].verified_download, null);
  assert.equal(value.findings[0].result_sha256, null);
});

test("BLAST, retrieved NCBI and protein annotation results aggregate in one conversation", () => {
  const value = dossier({
    plans: [
      plan(a, "dispatched", "blast", "blast_job", b),
      plan(b, "dispatched", "ncbi_sequence_retrieval", "sequence_retrieval", c),
      plan(c, "dispatched", "protein_annotation", "protein_annotation_job", d),
    ],
    blastJobs: [{ id: b, status: "completed", raw_result_sha256: h, result_summary: { hit_count: 4, api_key: "secret" } }],
    retrievals: [{ id: c, status: "retrieved", resolved_accession: "NM_000546.6", source_database: "nucleotide" }],
    annotations: [{ id: d, status: "completed", refseq_accession: "NP_000537.3", uniprot_accession: "P04637" }],
  });
  assert.equal(value.counts.completed, 3);
  assert.equal(value.findings[0].metrics[0].value, "4");
  assert.equal(value.findings[1].metrics[0].value, "NM_000546.6");
  assert.equal(value.findings[2].metrics[0].value, "NP_000537.3");
  assert.ok(!JSON.stringify(value).includes("api_key"));
});

test("parent workflow completion without child-job evidence is never accepted", () => {
  const value = dossier({
    plans: [plan(a, "dispatched", "msa_phylogeny_workflow", "ai_workflow", b)],
    workflows: [{ id: b, status: "completed", msa_job_id: c, phylogeny_job_id: d }],
  });
  assert.equal(value.findings[0].state, "unknown");
  assert.deepEqual(value.findings[0].steps.map(s => s.state), ["unknown", "unknown"]);
  assert.equal(value.counts.completed, 0);
});

test("MSA followed by phylogeny counts completed only with both child results", () => {
  const value = dossier({
    plans: [plan(a, "dispatched", "msa_phylogeny_workflow", "ai_workflow", b)],
    workflows: [{ id: b, status: "completed", msa_job_id: c, phylogeny_job_id: d }],
    workflowChildJobs: [
      { id: c, status: "completed", result_sha256: h, job_type: "multiple_sequence_alignment" },
      { id: d, status: "completed", result_sha256: h, job_type: "phylogenetic_tree" },
    ],
  });
  assert.equal(value.status, "complete");
  assert.deepEqual(value.findings[0].steps.map(s => s.state), ["completed", "completed"]);
  assert.deepEqual(value.findings[0].steps.map(s => s.result_sha256), [h, h]);
});

test("submitted MSA with unstarted tree is ongoing rather than a fabricated tree", () => {
  const value = dossier({
    plans: [plan(a, "dispatched", "msa_phylogeny_workflow", "ai_workflow", b)],
    workflows: [{ id: b, status: "running", msa_job_id: c, phylogeny_job_id: null }],
    workflowChildJobs: [{ id: c, status: "running" }],
  });
  assert.equal(value.findings[0].state, "running");
  assert.deepEqual(value.findings[0].steps.map(s => s.state), ["running", "not_started"]);
});

test("failed, no-mapping and missing RLS-visible resources never become successes", () => {
  const value = dossier({
    plans: [
      plan(a, "dispatched", "protein_annotation", "protein_annotation_job", b),
      plan(b, "dispatched", "blast", "blast_job", c),
      plan(c, "dispatched", "blast", "blast_job", d),
    ],
    annotations: [{ id: b, status: "no_mapping" }],
    blastJobs: [{ id: c, status: "failed", result_summary: { hit_count: 99 } }],
  });
  assert.deepEqual(value.findings.map(f => f.state), ["inconclusive", "failed", "unknown"]);
  assert.equal(value.counts.completed, 0);
});

test("deduplicates plan ids and refuses malformed ids or remote evidence links", () => {
  const value = dossier({
    plans: [
      plan("not-a-uuid", "dispatched", "blast", "blast_job", b),
      plan(a, "ready", "blast"),
      plan(a, "ready", "blast"),
      plan(e, "dispatched", "blast", "blast_job", "https://example.com/secret"),
    ],
  });
  assert.equal(value.counts.total, 2);
  assert.equal(value.findings[1].verified_download, null);
  assert.equal(value.findings[1].resource_id, null);
});

test("Markdown export includes only bounded public evidence and limitations", () => {
  const value = dossier({
    plans: [plan(a, "dispatched", "sequence_insights", "scientific_job", b)],
    scientificJobs: [{ id: b, status: "completed", result_sha256: h, result_object_path: "private",
      result_summary: { orf_count: 3, raw_sequence: "ATGAAATAA", private_token: "NEVER_EXPORT" } }],
  });
  const markdown = conversationDossierMarkdown(value);
  assert.match(markdown, /orf count: 3/);
  assert.match(markdown, /not experimentally verified/i);
  assert.doesNotMatch(markdown, /ATGAAATAA|NEVER_EXPORT|private_token|result_object_path/);
});

test("authenticated conversation loads child jobs with project scope before the dossier", () => {
  const page = readFileSync(new URL("../app/dashboard/ai/[id]/page.tsx", import.meta.url), "utf8");
  assert.match(page, /workflowChildIds/);
  assert.match(page, /\.eq\("project_id", conversation\.project_id\)/);
  assert.match(page, /buildConversationDossier/);
  assert.match(page, /<ConversationDossierPanel dossier=\{dossier\} \/>/);
  assert.ok(page.indexOf("<ConversationDossierPanel") < page.lastIndexOf("<AiChatComposer"));
});
