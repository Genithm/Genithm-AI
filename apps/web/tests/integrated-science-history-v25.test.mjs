import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildConversationDossier } from "../lib/conversation-research-dossier.ts";
import { archiveEvidenceLabel, archiveTemplate, parseResearchArchiveSearch } from "../lib/research-archive.ts";
import { MAX_CONVERSATION_EVIDENCE_RUNS, selectEvidenceRuns } from "../lib/integrated-science-history.ts";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const page = read("../app/dashboard/ai/[id]/page.tsx");
const archive = read("../app/dashboard/ai/research/page.tsx");
const uuid = (digit) => digit.repeat(8)+"-"+digit.repeat(4)+"-4"+digit.repeat(3)+"-8"+digit.repeat(3)+"-"+digit.repeat(12);
const id = uuid("1"), retrieval = uuid("2"), sequence = uuid("3"), job = uuid("4");
const hash = "a".repeat(64);

function historicalDossier(changes = {}) {
  const pipeline = {
    id, template: "ncbi_nucleotide_orf_v1", status: "completed",
    requested_accession: "NM_000546.6", retrieval_id: retrieval,
    sequence_upload_id: sequence, scientific_job_id: job, sequence_sha256: hash,
  };
  return buildConversationDossier({
    conversationId: uuid("5"),
    plans: [],
    fixedPipelines: [pipeline],
    fixedRetrievals: [{
      id: retrieval, status: "retrieved", requested_accession: "NM_000546.6",
      source_database: "nucleotide", sequence_upload_id: sequence,
    }],
    fixedSequences: [{ id: sequence, status: "ready", sha256: hash }],
    fixedScientificJobs: [{
      id: job, status: "completed", job_type: "sequence_insights",
      parameters: { operation: "orf_scan", min_aa: 30 },
      result_sha256: hash, result_object_path: "private/not-exportable",
      result_summary: { orf_count: 4, raw_sequence: "SECRET_SEQUENCE" },
    }],
    fixedJobInputs: [{
      job_id: job, input_position: 1, sequence_upload_id: sequence, input_sha256: hash,
    }],
    ...changes,
  });
}

test("V25 old run has the same completed verified evidence as a recent approved run", () => {
  const dossier = historicalDossier();
  assert.equal(dossier.findings.length, 1);
  const finding = dossier.findings[0];
  assert.equal(finding.source, "fixed_pipeline");
  assert.equal(finding.pipeline_id, id);
  assert.equal(finding.state, "completed");
  assert.equal(finding.verified_download, "/dashboard/scientific-jobs/"+job+"/download");
  assert.deepEqual(finding.metrics, [{ label: "orf count", value: "4" }]);
  assert.doesNotMatch(JSON.stringify(dossier), /SECRET_SEQUENCE|private\/not-exportable/);
});

test("V25 a completed parent with missing, mismatched or tampered children stays unverified", () => {
  const variants = [
    { fixedRetrievals: [] },
    { fixedRetrievals: [{ id: retrieval, status: "retrieved", requested_accession: "NM_000546.6",
      source_database: "nucleotide", sequence_upload_id: uuid("6") }] },
    { fixedSequences: [{ id: sequence, status: "ready", sha256: "b".repeat(64) }] },
    { fixedJobInputs: [{ job_id: job, input_position: 1,
      sequence_upload_id: sequence, input_sha256: "b".repeat(64) }] },
    { fixedScientificJobs: [{ id: job, status: "completed", job_type: "sequence_insights",
      parameters: { operation: "orf_scan", min_aa: 29 }, result_sha256: hash, result_object_path: "private" }] },
  ];
  for (const changes of variants) {
    const result = historicalDossier(changes).findings[0];
    assert.equal(result.state, "unknown", JSON.stringify(changes));
    assert.equal(result.metrics.length, 0);
    assert.equal(result.verified_download, null);
  }
});

test("V25 one proven message-to-run link is required before old-run evidence is collected", () => {
  assert.match(page, /sourceLookup\.eq\("id", sourceMessageId\)\.maybeSingle\(\)/);
  assert.match(page, /\.eq\("conversation_owner_id", claimsData\.claims\.sub\)/);
  assert.match(page, /\.eq\("research_pipeline_run_id", candidatePipelineId \?\? ""\)/);
  assert.match(page, /exactSourceAuthorized/);
  assert.match(page, /query\.pipeline_id !== undefined \? requestedPipelineId/);
  assert.match(page, /selectEvidenceRuns\(/);
  assert.match(page, /evidencePipelines/);
  assert.match(page, /fixedPipelines: fixedEvidenceQueryError \? \[\] : evidencePipelines/);
  assert.match(page, /fixedEvidenceQueryError/);
  assert.match(page, /selectedPipelineEvidence\?\.state === "completed"/);
  assert.doesNotMatch(page, /pipelineScience\.result_object_path/);
});

test("V25 archive batches inputs only for message-linked, owner-scoped research", () => {
  assert.match(archive, /const authorizedRuns = \[\.\.\.new Set\(entries\.map\(\(entry\) => entry\.pipelineId\)\)\]/);
  assert.match(archive, /\.eq\("conversation_owner_id", userId\)/);
  assert.match(archive, /\.eq\("created_by", userId\)/);
  assert.match(archive, /\.eq\("requested_by", userId\)/);
  assert.match(archive, /\.in\("project_id", projectIds\)/);
  assert.match(archive, /\.from\("scientific_job_inputs"\)/);
  assert.match(archive, /\.select\("id,status,job_type,parameters,result_sha256,result_object_path,result_summary"\)/);
  assert.match(archive, /fixedPipelines: \[run\]/);
  assert.match(archive, /archiveEvidenceLabel\(evidenceLoadError \? null/);
  assert.match(archive, /finding\?\.state === "completed" \? finding\.verified_download : null/);
  assert.doesNotMatch(archive, /createServiceClient|service_role|NEXT_PUBLIC_SERVICE/);
});

test("V25 engine and evidence statuses remain explicitly different", () => {
  assert.equal(archiveTemplate("ncbi_nucleotide_orf_v1"), "NCBI nucleotide ORF analysis");
  assert.equal(archiveEvidenceLabel("completed"), "Recorded evidence verified");
  assert.equal(archiveEvidenceLabel("unknown"), "Evidence incomplete");
  assert.equal(archiveEvidenceLabel("failed"), "Research failed");
  assert.equal(archiveEvidenceLabel("running"), "Evidence still accumulating");
  assert.equal(archiveEvidenceLabel(null), "Evidence unavailable");
  assert.equal(parseResearchArchiveSearch({before_id:id}).invalid, true);
});

test("V25 historical selection cannot be evicted by 100 more recent linked runs", () => {
  const recent = Array.from({ length: 110 }, (_, i) => ({ id: "recent-"+i, status: "completed" }));
  const chosen = { id: "older-consented-run", status: "completed" };
  const result = selectEvidenceRuns(recent, chosen);
  assert.equal(MAX_CONVERSATION_EVIDENCE_RUNS, 100);
  assert.equal(result.length, 100);
  assert.equal(result[0].id, chosen.id);
  assert.equal(result.some((run) => run.id === recent[109].id), false);
  assert.equal(selectEvidenceRuns([{id:chosen.id,status:"completed"}], chosen).length, 1);
  assert.equal(selectEvidenceRuns(recent, null).length, 100);
});
