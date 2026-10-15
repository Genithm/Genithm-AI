import { recordedEvidenceMetrics, type EvidenceMetric } from "./recorded-chat-evidence.ts";
import { pipelineProgress } from "./chat-research-protocol.ts";

/** Pure evidence-only dossier. Callers must supply conversation- and RLS-scoped rows. */
type Row = Record<string, unknown>;
const TYPES = ["scientific_job","blast_job","sequence_retrieval","protein_annotation_job","ai_workflow"] as const;
type Kind = (typeof TYPES)[number];
type State = "awaiting_approval" | "running" | "completed" | "failed" | "inconclusive" | "unknown";
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const SHA = /^[a-f0-9]{64}$/i;
export type DossierStep = { label: string; state: State | "not_started"; job_id: string | null; result_sha256: string | null };
export type DossierFinding = {
  plan_id: string | null; pipeline_id: string | null; source: "plan" | "fixed_pipeline";
  action: string; state: State; kind: Kind | null; resource_id: string | null;
  metrics: EvidenceMetric[]; result_sha256: string | null;
  verified_download: string | null; steps: DossierStep[];
};
export type ConversationDossier = {
  version: "science-dossier-v19"; conversation_id: string;
  status: "empty" | "awaiting_approval" | "running" | "complete" | "partial" | "failed";
  counts: { total: number; completed: number; running: number; awaiting_approval: number; failed: number; inconclusive: number; unknown: number };
  findings: DossierFinding[]; caveats: string[];
};
function obj(v: unknown): Row { return typeof v === "object" && v !== null && !Array.isArray(v) ? v as Row : {}; }
function str(v: unknown): string | null { return typeof v === "string" && v.length > 0 ? v : null; }
function uid(v: unknown): string | null { const s = str(v); return s && UUID.test(s) ? s : null; }
function sha(v: unknown): string | null { const s = str(v); return s && SHA.test(s) ? s.toLowerCase() : null; }
function list(v: unknown): Row[] { return Array.isArray(v) ? v.slice(0, 150).map(obj) : []; }
function keyed(v: unknown): Map<string, Row> {
  const result = new Map<string, Row>();
  for (const row of list(v)) { const key = uid(row.id); if (key && !result.has(key)) result.set(key, row); }
  return result;
}
function allowedAction(v: unknown): string {
  const s = str(v);
  return s && /^[a-z_]{2,64}$/.test(s) ? s.replaceAll("_", " ") : "Scientific analysis";
}
function stateOf(kind: Kind, row: Row): State {
  const s = str(row.status);
  if ((kind === "sequence_retrieval" && s === "retrieved") ||
      (kind !== "sequence_retrieval" && s === "completed")) return "completed";
  if (s === "not_found" || s === "no_mapping") return "inconclusive";
  if (["error","failed","cancelled","rejected"].includes(s ?? "")) return "failed";
  if (["queued","running","processing","submitted","retrieving","polling","pending","ready"].includes(s ?? "")) return "running";
  return "unknown";
}
function workflowStep(label: string, rawId: unknown, children: Map<string, Row>): DossierStep {
  const jobId = uid(rawId);
  if (!jobId) return { label, state: "not_started", job_id: null, result_sha256: null };
  const job = children.get(jobId);
  if (!job) return { label, state: "unknown", job_id: jobId, result_sha256: null };
  const state = stateOf("scientific_job", job);
  return { label, state, job_id: jobId, result_sha256: state === "completed" ? sha(job.result_sha256) : null };
}
function workflowState(parent: Row, steps: DossierStep[]): State {
  const s = str(parent.status);
  if (["error","failed","cancelled"].includes(s ?? "") || steps.some(x => x.state === "failed")) return "failed";
  if (s === "completed" && steps.length === 2 && steps.every(x => x.state === "completed")) return "completed";
  if (["running","queued"].includes(s ?? "") || steps.some(x => x.state === "running")) return "running";
  return "unknown";
}
export function buildConversationDossier(input: {
  conversationId: string; plans: unknown; scientificJobs?: unknown; blastJobs?: unknown;
  retrievals?: unknown; annotations?: unknown; workflows?: unknown; workflowChildJobs?: unknown;
  fixedPipelines?: unknown; fixedRetrievals?: unknown; fixedSequences?: unknown;
  fixedScientificJobs?: unknown; fixedJobInputs?: unknown;
}): ConversationDossier {
  const resources: Record<Kind, Map<string, Row>> = {
    scientific_job: keyed(input.scientificJobs), blast_job: keyed(input.blastJobs),
    sequence_retrieval: keyed(input.retrievals), protein_annotation_job: keyed(input.annotations),
    ai_workflow: keyed(input.workflows),
  };
  const children = keyed(input.workflowChildJobs);
  const seen = new Set<string>();
  const findings: DossierFinding[] = [];
  for (const plan of list(input.plans).slice(0, 100)) {
    const planId = uid(plan.id);
    if (!planId || seen.has(planId)) continue;
    seen.add(planId);
    const kindText = str(plan.dispatched_resource_type);
    const kind = kindText && TYPES.includes(kindText as Kind) ? kindText as Kind : null;
    const resourceId = uid(plan.dispatched_resource_id);
    const row = kind && resourceId ? resources[kind].get(resourceId) : undefined;
    const planStatus = str(plan.status);
    const steps: DossierStep[] = [];
    let state: State = "unknown";
    if (planStatus === "ready") state = "awaiting_approval";
    else if (["error","failed","cancelled"].includes(planStatus ?? "")) state = "failed";
    else if (kind && row) {
      if (kind === "ai_workflow") {
        steps.push(workflowStep("Multiple sequence alignment", row.msa_job_id, children));
        steps.push(workflowStep("Phylogenetic tree", row.phylogeny_job_id, children));
        state = workflowState(row, steps);
      } else state = stateOf(kind, row);
    } else if (["planning","processing"].includes(planStatus ?? "")) state = "running";
    // Missing RLS-visible job records are unknown, never completed.
    const resultSha = state === "completed" && row
      ? sha(kind === "blast_job" ? row.raw_result_sha256
        : kind === "scientific_job" ? row.result_sha256 : null) : null;
    const download = kind === "scientific_job" && state === "completed" && resourceId &&
      resultSha && str(row?.result_object_path)
      ? "/dashboard/scientific-jobs/" + resourceId + "/download" : null;
    const metrics = state === "completed" && kind && kind !== "ai_workflow" && row
      ? recordedEvidenceMetrics(kind, row) : [];
    findings.push({
      plan_id: planId, pipeline_id: null, source: "plan", action: allowedAction(plan.action_type), state,
      kind, resource_id: resourceId, metrics,
      result_sha256: resultSha, verified_download: download, steps,
    });
  }
  // V23: fixed NCBI pipelines are separate from AI plan requests. The caller
  // supplies only RLS-visible rows for run IDs bound to this conversation.
  const fixedSource = keyed(input.fixedRetrievals);
  const fixedSequence = keyed(input.fixedSequences);
  const fixedScience = keyed(input.fixedScientificJobs);
  const fixedInputs = list(input.fixedJobInputs);
  const pipelineSeen = new Set<string>();
  for (const run of list(input.fixedPipelines).slice(0, 100)) {
    const pipelineId = uid(run.id);
    if (!pipelineId || pipelineSeen.has(pipelineId)) continue;
    pipelineSeen.add(pipelineId);
    const template = str(run.template);
    if (template !== "ncbi_nucleotide_orf_v1" && template !== "ncbi_protein_profile_v1") continue;
    const retrievalId = uid(run.retrieval_id);
    const sequenceId = uid(run.sequence_upload_id);
    const jobId = uid(run.scientific_job_id);
    const retrieval = retrievalId ? fixedSource.get(retrievalId) : undefined;
    const sequence = sequenceId ? fixedSequence.get(sequenceId) : undefined;
    const science = jobId ? fixedScience.get(jobId) : undefined;
    const expectedJob = template === "ncbi_nucleotide_orf_v1" ? "sequence_insights" : "protein_properties";
    const hash = sha(run.sequence_sha256);
    const jobInputs = fixedInputs.filter((record) => uid(record.job_id) === jobId);
    const matchingInput = jobInputs.length === 1 && jobInputs[0].input_position === 1 &&
      uid(jobInputs[0].sequence_upload_id) === sequenceId &&
      sha(jobInputs[0].input_sha256) === hash;
    const parameters = obj(science?.parameters);
    const operationValid = template !== "ncbi_nucleotide_orf_v1" ||
      (parameters.operation === "orf_scan" && String(parameters.min_aa) === "30");
    const provenanceValid = Boolean(
      retrieval && retrieval.status === "retrieved" &&
      sequence && sequence.status === "ready" && hash &&
      sha(sequence.sha256) === hash && matchingInput &&
      science && science.status === "completed" && science.job_type === expectedJob &&
      operationValid && sha(science.result_sha256) && str(science.result_object_path)
    );
    const progress = pipelineProgress(
      template, str(run.status) ?? "",
      str(retrieval?.status), str(sequence?.status), str(science?.status)
    );
    const steps: DossierStep[] = progress.map((step, i) => {
      const id = [retrievalId, sequenceId, jobId][i];
      const hasRecord = [Boolean(retrieval), Boolean(sequence), Boolean(science)][i];
      const stageSha = i === 2 && provenanceValid ? sha(science?.result_sha256) : null;
      return {
        label: step.name,
        state: !hasRecord && id ? "unknown" :
          step.status === "waiting" ? "not_started" :
          step.status === "completed" && i === 2 && !provenanceValid ? "unknown" :
          step.status,
        job_id: id,
        result_sha256: stageSha,
      };
    });
    const parentStatus = str(run.status);
    const state: State =
      parentStatus === "error" ? "failed" :
      parentStatus === "completed" ? (provenanceValid ? "completed" : "unknown") :
      ["awaiting_source", "awaiting_validation", "running"].includes(parentStatus ?? "")
        ? "running" : "unknown";
    const resultSha = state === "completed" ? sha(science?.result_sha256) : null;
    const download = resultSha && jobId && str(science?.result_object_path)
      ? "/dashboard/scientific-jobs/" + jobId + "/download" : null;
    const metrics = state === "completed" && science
      ? recordedEvidenceMetrics("scientific_job", science) : [];
    findings.push({
      plan_id: null, pipeline_id: pipelineId, source: "fixed_pipeline",
      action: template === "ncbi_nucleotide_orf_v1" ? "NCBI nucleotide ORF scan" : "NCBI protein profiling",
      state, kind: "scientific_job", resource_id: jobId, metrics,
      result_sha256: resultSha, verified_download: download, steps,
    });
  }

  const counts = {
    total: findings.length,
    completed: findings.filter(x => x.state === "completed").length,
    running: findings.filter(x => x.state === "running").length,
    awaiting_approval: findings.filter(x => x.state === "awaiting_approval").length,
    failed: findings.filter(x => x.state === "failed").length,
    inconclusive: findings.filter(x => x.state === "inconclusive").length,
    unknown: findings.filter(x => x.state === "unknown").length,
  };
  const status: ConversationDossier["status"] =
    !counts.total ? "empty" : counts.running ? "running" :
    counts.awaiting_approval ? "awaiting_approval" :
    counts.completed === counts.total ? "complete" :
    (counts.completed || counts.inconclusive || counts.unknown) ? "partial" : "failed";
  return {
    version: "science-dossier-v19", conversation_id: input.conversationId,
    counts, status, findings,
    caveats: [
      "These are recorded computational results, not experimentally verified biological conclusions.",
      "Missing, inaccessible, and pending jobs are never reported as completed.",
      "Multi-step workflow completion requires evidence from every scientific dependency.",
      "Fixed NCBI pipelines require recorded retrieval, matching FASTA and scientific input hashes, fixed compute parameters, and a valid result fingerprint before completion.",
    ],
  };
}
function escapeText(v: string): string { return v.replace(/[\r\n]/g, " ").replace(/[\\*_\[\]<>|]/g, "\\$&"); }
export function conversationDossierMarkdown(d: ConversationDossier): string {
  const out = ["# Genithm research dossier", "",
    "Recorded scientific evidence; not experimental verification.", "",
    "Conversation: " + escapeText(d.conversation_id), "Overall status: " + d.status, ""];
  for (const [i, f] of d.findings.entries()) {
    out.push("## " + (i + 1) + ". " + escapeText(f.action), "Status: " + f.state);
    for (const m of f.metrics) out.push("- " + escapeText(m.label) + ": " + escapeText(m.value));
    for (const st of f.steps) out.push("- " + escapeText(st.label) + ": " + st.state);
    if (f.result_sha256) out.push("Output SHA-256: " + f.result_sha256);
    out.push("");
  }
  out.push("## Limitations", ...d.caveats.map(c => "- " + escapeText(c)), "");
  return out.join("\n");
}
