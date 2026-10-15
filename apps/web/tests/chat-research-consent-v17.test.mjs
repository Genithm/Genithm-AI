import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { buildAuthorizedResearchContext } from "../lib/authorized-research-context.ts";
import { recordedEvidenceMetrics } from "../lib/recorded-chat-evidence.ts";

const id1 = "11111111-1111-4111-8111-111111111111";
const id2 = "22222222-2222-4222-8222-222222222222";
const id3 = "33333333-3333-4333-8333-333333333333";
const id4 = "44444444-4444-4444-8444-444444444444";
const hash = "a".repeat(64);
const read = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8");

test("planner adds bounded project-derived preflight and retains multi-turn history", () => {
  const context = buildAuthorizedResearchContext({
    project: { id: id4 },
    conversation_history: [
      { role: "user", content: "Fetch TP53 for me" },
      { role: "assistant", content: "Which organism?" },
    ],
    sequences: [
      { id: id1, filename: "input.fa", sequence_type: "dna", sha256: hash, residue_count: 100 },
      { id: id2, filename: "p.faa", sequence_type: "protein", sha256: hash, residue_count: 50 },
      { id: id3, filename: "still-pending.fa", sequence_type: "rna", sha256: "", residue_count: 70 },
      { id: id1, filename: "duplicate.fa", sequence_type: "dna", sha256: hash, residue_count: 100 },
      { id: "forged", filename: "forged.fa", sequence_type: "protein", sha256: hash, residue_count: 50 },
    ],
    current_attachments: [{ id: id3, status: "pending_validation", filename: "still-pending.fa" }],
    ncbi_retrievals: [
      { source_database: "protein", status: "retrieved", sequence_upload_id: id2 },
      { source_database: "protein", status: "queued", sequence_upload_id: id1 },
    ],
    scientific_jobs: [
      { id: id4, job_type: "multiple_sequence_alignment", status: "completed", result_sha256: hash },
      { id: id3, job_type: "multiple_sequence_alignment", status: "running", result_sha256: hash },
    ],
  });
  assert.equal(context.capability_preflight.ready_sequences.length, 2);
  assert.deepEqual(context.capability_preflight.blastn_candidate_sequences.map(s => s.id), [id1]);
  assert.deepEqual(context.capability_preflight.blastp_candidate_sequences.map(s => s.id), [id2]);
  assert.deepEqual(context.capability_preflight.protein_annotation_candidates.map(s => s.id), [id2]);
  assert.deepEqual(context.capability_preflight.completed_msa_jobs.map(s => s.id), [id4]);
  assert.equal(context.capability_preflight.current_attachments[0].status, "pending_validation");
  assert.equal(context.conversation_history[1].content, "Which organism?");
  assert.match(context.capability_preflight.basis, /independently revalidate/);
});

test("missing or malformed scoped context is never replaced with invented resource IDs", () => {
  assert.throws(() => buildAuthorizedResearchContext(null), /Authorized research context/);
  const ctx = buildAuthorizedResearchContext({ sequences: [{ id: id1, sequence_type: "protein", sha256: "", residue_count: 10 }] });
  assert.equal(ctx.capability_preflight.ready_sequences.length, 0);
  assert.equal(ctx.capability_preflight.completed_msa_jobs.length, 0);
});

test("recorded scientific evidence is allowlisted, bounded and completion-gated", () => {
  const input = { status: "completed", result_summary: {
    operation: "orf_scan", orf_count: 2, sequence_type: "dna",
    raw_sequence: "ATGAAATAA", private_token: "SECRET",
    unexpected_html: "<img onerror=evil>", annotations: ["unreviewed"],
  }};
  const result = recordedEvidenceMetrics("scientific_job", input);
  assert.deepEqual(result, [
    { label: "operation", value: "orf_scan" },
    { label: "sequence type", value: "dna" },
    { label: "orf count", value: "2" },
  ]);
  assert.deepEqual(recordedEvidenceMetrics("scientific_job", { ...input, status: "running" }), []);
});

test("BLAST and NCBI evidence have dedicated schema-aware projections", () => {
  assert.deepEqual(recordedEvidenceMetrics("blast_job", {
    status: "completed", result_summary: { hit_count: 6, best_evalue: 1e-8, provider_secret: "HIDDEN" },
  }), [{ label: "hit count", value: "6" }, { label: "best evalue", value: "1e-8" }]);
  assert.deepEqual(recordedEvidenceMetrics("sequence_retrieval", {
    status: "retrieved", resolved_accession: "NM_000546.6", source_database: "nucleotide",
    sequence_upload_id: id1, provider_secret: "HIDDEN",
  }), [
    { label: "NCBI accession", value: "NM_000546.6" },
    { label: "NCBI database", value: "nucleotide" },
    { label: "Validated sequence reference", value: id1 },
  ]);
  assert.deepEqual(recordedEvidenceMetrics("protein_annotation_job", {
    status: "completed", refseq_accession: "NP_000537.3",
    uniprot_accession: "P04637", protein_name: "Cellular tumor antigen p53",
    uniprot_reviewed: true, api_key: "NEVER",
  }), [
    { label: "RefSeq accession", value: "NP_000537.3" },
    { label: "UniProt accession", value: "P04637" },
    { label: "Protein", value: "Cellular tumor antigen p53" },
    { label: "uniprot reviewed", value: "Yes" },
  ]);
});

test("science requests cannot silently dispatch before explicit in-chat approval", () => {
  const route = read("../app/api/ai/chat/route.ts");
  const systemPrompt = read("../lib/genithm-ai-chat.ts");
  const conversation = read("../app/dashboard/ai/[id]/page.tsx");
  const actions = read("../app/dashboard/ai/actions.ts");
  assert.match(route, /create_ai_plan_from_chat/);
  assert.doesNotMatch(route, /dispatch_ai_plan_service/);
  assert.match(route, /status: "awaiting_approval"/);
  assert.match(route, /requires_confirmation: true/);
  assert.match(route, /buildAuthorizedResearchContext\(row.authorized_context\)/);
  assert.match(systemPrompt, /conversation_history/);
  assert.match(systemPrompt, /must approve it before authoritative execution/);
  assert.match(conversation, /Approve this analysis/);
  assert.match(actions, /supabase.rpc\("approve_ai_plan"/);
});

test("scientific results remain directly in chat with safe server-verified download", () => {
  const conversation = read("../app/dashboard/ai/[id]/page.tsx");
  assert.match(conversation, /recordedEvidenceMetrics/);
  assert.match(conversation, /blastById/);
  assert.match(conversation, /annotationById/);
  assert.match(conversation, /retrievalById/);
  assert.match(conversation, /dashboard\/scientific-jobs\/\$\{scientificResult.id\}\/download/);
  assert.match(conversation, /Recorded result fingerprint/);
});
