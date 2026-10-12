/**
 * Science V10 research operations read model.
 *
 * No database writes, raw prompts, sequence content, evidence blobs or credentials.
 * Every row must be obtained through an authenticated RLS-scoped Supabase query.
 */
export const PIPELINES = [
  "scientific", "blast", "ncbi", "protein_annotation", "sequence_input",
  "ai_plan", "ai_interpretation", "ai_followup", "ai_workflow",
] as const;

export type Pipeline = (typeof PIPELINES)[number];
export type OperationState = "queued" | "running" | "needs_action" | "completed" | "failed" | "cancelled" | "unknown";
export type OperationsSourceRow = {
  id: string;
  project_id: string;
  status: string;
  created_at: string;
  updated_at?: string | null;
  processing_started_at?: string | null;
  processing_attempts?: number | null;
  submission_attempts?: number | null;
  processing_error?: string | null;
  conversation_id?: string | null;
  job_type?: string | null;
  workflow_type?: string | null;
  action_type?: string | null;
  program?: string | null;
  database_name?: string | null;
  requested_accession?: string | null;
  refseq_accession?: string | null;
  original_filename?: string | null;
  tool_id?: string | null;
  requires_confirmation?: boolean | null;
};
export type Operation = {
  id: string;
  projectId: string;
  pipeline: Pipeline;
  pipelineLabel: string;
  label: string;
  rawStatus: string;
  state: OperationState;
  attention: boolean;
  attentionReason: string | null;
  createdAt: string;
  updatedAt: string;
  ageSeconds: number | null;
  attempts: number | null;
  href: string | null;
};
export type OperationsSummary = {
  visible: number;
  queued: number;
  running: number;
  needsAction: number;
  completed: number;
  failed: number;
  cancelled: number;
  unknown: number;
  attention: number;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_TITLE = 112;
const LABELS: Record<Pipeline, string> = {
  scientific: "Scientific computation",
  blast: "BLAST search",
  ncbi: "NCBI retrieval",
  protein_annotation: "Protein annotation",
  sequence_input: "Sequence validation",
  ai_plan: "AI research plan",
  ai_interpretation: "AI interpretation",
  ai_followup: "Evidence follow-up",
  ai_workflow: "AI scientific workflow",
};
const SUCCESS: Record<Pipeline, ReadonlySet<string>> = {
  scientific: new Set(["completed"]),
  blast: new Set(["completed"]),
  ncbi: new Set(["retrieved", "not_found"]),
  protein_annotation: new Set(["completed", "no_mapping"]),
  sequence_input: new Set(["ready"]),
  ai_plan: new Set(["dispatched", "completed"]),
  ai_interpretation: new Set(["completed"]),
  ai_followup: new Set(["completed"]),
  ai_workflow: new Set(["completed"]),
};
const FAILURE = new Set(["error", "failed", "rejected", "failure"]);
const CANCELLATIONS = new Set(["cancelled", "canceled"]);
const WAITING = new Set(["queued", "pending", "created", "uploaded", "requested", "waiting", "awaiting_worker"]);
const WORKING = new Set([
  "running", "processing", "retrieving", "validating", "validating_result",
  "submitting", "submitted", "polling", "executing", "in_progress",
  "resolving", "dispatching", "interpreting", "planning", "analyzing",
]);
const ACTION = new Set(["ready_for_approval", "awaiting_confirmation", "awaiting_approval", "requires_approval"]);
const QUEUE_ATTENTION_SECONDS = 5 * 60;
const ACTIVE_ATTENTION_SECONDS = 15 * 60;

function dateMs(date: unknown): number | null {
  if (typeof date !== "string" || date.length > 64) return null;
  const ms = Date.parse(date);
  return Number.isFinite(ms) ? ms : null;
}
function asLabel(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return clean ? clean.slice(0, MAX_TITLE) : fallback;
}
export function classifyOperationState(pipeline: Pipeline, value: unknown): OperationState {
  const s = typeof value === "string" ? value.toLowerCase() : "";
  if (SUCCESS[pipeline].has(s)) return "completed";
  if (CANCELLATIONS.has(s)) return "cancelled";
  if (FAILURE.has(s)) return "failed";
  if ((pipeline === "ai_plan" && s === "ready") || ACTION.has(s)) return "needs_action";
  if (WAITING.has(s)) return "queued";
  if (WORKING.has(s)) return "running";
  // Unknown states cannot be silently counted as actively executing or healthy.
  return "unknown";
}
function title(pipeline: Pipeline, row: OperationsSourceRow) {
  switch (pipeline) {
    case "scientific": return asLabel(row.job_type?.replaceAll("_", " "), "Scientific analysis");
    case "blast": return asLabel(
      [row.program, row.database_name].filter(Boolean).join(" · ").toUpperCase(), "BLAST analysis");
    case "ncbi": return asLabel(row.requested_accession, "NCBI accession retrieval");
    case "protein_annotation": return asLabel(row.refseq_accession, "Protein annotation");
    case "sequence_input": return asLabel(row.original_filename, "Sequence FASTA");
    case "ai_plan": return asLabel(row.action_type?.replaceAll("_", " "), "AI research planning");
    case "ai_interpretation": return "Evidence-grounded interpretation";
    case "ai_followup": return "Scientific evidence follow-up";
    case "ai_workflow": return asLabel(row.workflow_type?.replaceAll("_", " "), "Multi-step scientific workflow");
  }
}
function resourceLink(pipeline: Pipeline, row: OperationsSourceRow): string | null {
  const id = row.id;
  if (pipeline === "scientific" && UUID.test(id)) return "/dashboard/scientific-jobs/" + id;
  if (pipeline === "protein_annotation" && UUID.test(id)) return "/dashboard/protein-annotations/" + id;
  if (pipeline === "ai_plan" || pipeline === "ai_interpretation" ||
      pipeline === "ai_followup" || pipeline === "ai_workflow") {
    if (row.conversation_id && UUID.test(row.conversation_id)) {
      return "/dashboard/ai/" + row.conversation_id;
    }
    return null;
  }
  return "/dashboard/tools";
}
export function normalizeOperation(
  pipeline: Pipeline,
  row: OperationsSourceRow,
  now: number,
): Operation | null {
  if (!row || !UUID.test(row.id) || !UUID.test(row.project_id)) return null;
  const state = classifyOperationState(pipeline, row.status);
  const createdMs = dateMs(row.created_at);
  const updatedMs = dateMs(row.updated_at) ?? createdMs;
  // The queue age begins when the request is created. For running jobs,
  // processing_started_at is authoritative when available.
  const startMs = state === "queued" ? createdMs :
    state === "running" ? dateMs(row.processing_started_at) ?? updatedMs : updatedMs;
  const ageSeconds = startMs === null ? null : Math.max(0, Math.floor((now - startMs) / 1000));
  const longQueue = state === "queued" && ageSeconds !== null && ageSeconds > QUEUE_ATTENTION_SECONDS;
  const longRunning = state === "running" && ageSeconds !== null && ageSeconds > ACTIVE_ATTENTION_SECONDS;
  const attention = state === "failed" || state === "unknown" || longQueue || longRunning;
  const attentionReason = state === "failed" ? "The pipeline reported a failure." :
    state === "unknown" ? "An unrecognized lifecycle status requires review." :
    longQueue ? "Queued over five minutes; check worker availability." :
    longRunning ? "Active over fifteen minutes; verify worker progress." : null;
  const attempt = row.processing_attempts ?? row.submission_attempts;
  return {
    id: row.id, projectId: row.project_id, pipeline, pipelineLabel: LABELS[pipeline],
    label: title(pipeline, row), rawStatus: asLabel(row.status, "unknown"),
    state, attention, attentionReason, createdAt: row.created_at,
    updatedAt: row.updated_at ?? row.created_at, ageSeconds,
    attempts: typeof attempt === "number" && Number.isSafeInteger(attempt) && attempt >= 0 ? attempt : null,
    href: resourceLink(pipeline, row),
  };
}
export function summarizeOperations(rows: readonly Operation[]): OperationsSummary {
  const summary: OperationsSummary = {
    visible: rows.length, queued: 0, running: 0, needsAction: 0,
    completed: 0, failed: 0, cancelled: 0, unknown: 0, attention: 0,
  };
  for (const row of rows) {
    if (row.state === "needs_action") summary.needsAction++;
    else summary[row.state]++;
    if (row.attention) summary.attention++;
  }
  return summary;
}
export function collectOperations(
  sources: Partial<Record<Pipeline, readonly OperationsSourceRow[]>>,
  now: number,
): Operation[] {
  if (!Number.isFinite(now)) return [];
  const output: Operation[] = [];
  for (const pipeline of PIPELINES) {
    for (const row of sources[pipeline] ?? []) {
      const normalized = normalizeOperation(pipeline, row, now);
      if (normalized) output.push(normalized);
    }
  }
  output.sort((a, b) => (dateMs(b.createdAt) ?? 0) - (dateMs(a.createdAt) ?? 0) ||
    a.pipeline.localeCompare(b.pipeline) || a.id.localeCompare(b.id));
  return output;
}
