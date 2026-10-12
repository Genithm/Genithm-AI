/**
 * Science V11 — read-only, fail-closed reconciliation for the existing
 * two-step MSA -> FastTree workflow. Never performs retries or database writes.
 */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA_RE = /^[0-9a-f]{64}$/;
const FINISHED = new Set(["completed", "error", "cancelled"]);
const ACTIVE = new Set(["queued", "running", "validating_result"]);
const RUNNING = new Set(["running", "validating_result"]);

export type WorkflowRun = {
  id: string;
  organization_id: string;
  project_id: string;
  requested_by: string;
  conversation_id: string;
  workflow_type: string;
  status: string;
  msa_job_id: string;
  phylogeny_job_id: string | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
};

export type ScientificStep = {
  id: string;
  organization_id: string;
  project_id: string;
  requested_by: string;
  job_type: string;
  status: string;
  created_at: string;
  updated_at: string;
  processing_started_at: string | null;
  processing_finished_at: string | null;
  processing_attempts: number;
  result_sha256: string | null;
};

export type WorkflowDependency = {
  job_id: string;
  dependency_job_id: string;
  organization_id: string;
  project_id: string;
  dependency_role: string;
  dependency_result_sha256: string;
};

export type StageState = "pending" | "queued" | "active" | "completed" | "failed" | "cancelled" | "unavailable";
export type FindingSeverity = "info" | "attention" | "critical";
export type WorkflowFinding = {
  code: string;
  severity: FindingSeverity;
  title: string;
  guidance: string;
};
export type StageEvidence = {
  id: string | null;
  title: string;
  state: StageState;
  rawStatus: string | null;
  attempts: number | null;
  createdAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  resultSha256: string | null;
  href: string | null;
};
export type WorkflowDiagnostic = {
  workflowId: string;
  conversationId: string;
  projectId: string;
  state: "running" | "completed" | "error" | "cancelled" | "inconsistent";
  headline: string;
  stage: "msa" | "handoff" | "phylogeny" | "finished";
  stages: [StageEvidence, StageEvidence];
  lineage: "pending" | "verified_metadata" | "mismatch" | "unavailable";
  findings: WorkflowFinding[];
  needsReview: boolean;
  refreshing: boolean;
  observedAt: string;
};

function safeDate(text: unknown): number | null {
  if (typeof text !== "string" || text.length > 70) return null;
  const date = Date.parse(text);
  return Number.isFinite(date) ? date : null;
}
function elapsed(now: number, then: string | null) {
  const when = safeDate(then);
  return when === null ? null : Math.max(0, (now - when) / 1000);
}
function stageState(status: string): StageState {
  if (status === "completed") return "completed";
  if (status === "cancelled") return "cancelled";
  if (status === "error") return "failed";
  if (status === "queued") return "queued";
  if (RUNNING.has(status)) return "active";
  return "unavailable";
}
function stage(step: ScientificStep | null, id: string | null, title: string): StageEvidence {
  return {
    id,
    title,
    state: step ? stageState(step.status) : id ? "unavailable" : "pending",
    rawStatus: step?.status ?? null,
    attempts: typeof step?.processing_attempts === "number" && Number.isSafeInteger(step.processing_attempts)
      ? step.processing_attempts : null,
    createdAt: step?.created_at ?? null,
    startedAt: step?.processing_started_at ?? null,
    finishedAt: step?.processing_finished_at ?? null,
    resultSha256: step?.result_sha256 ?? null,
    href: id && UUID_RE.test(id) ? "/dashboard/scientific-jobs/" + id : null,
  };
}
function validScope(workflow: WorkflowRun, step: ScientificStep | null, id: string, type: string) {
  return step !== null
    && step.id === id
    && step.job_type === type
    && step.project_id === workflow.project_id
    && step.organization_id === workflow.organization_id
    && step.requested_by === workflow.requested_by;
}

export function reconcileWorkflow(
  workflow: WorkflowRun,
  msa: ScientificStep | null,
  phylogeny: ScientificStep | null,
  dependency: WorkflowDependency | null,
  at: number,
): WorkflowDiagnostic {
  if (!UUID_RE.test(workflow.id) || !UUID_RE.test(workflow.organization_id) ||
      !UUID_RE.test(workflow.project_id) || !UUID_RE.test(workflow.requested_by) ||
      !UUID_RE.test(workflow.conversation_id) || !UUID_RE.test(workflow.msa_job_id) ||
      (workflow.phylogeny_job_id !== null && !UUID_RE.test(workflow.phylogeny_job_id)) ||
      workflow.workflow_type !== "msa_phylogeny" || !Number.isFinite(at)) {
    throw new Error("Unrecognized workflow identity or workflow type.");
  }
  const observedAt = new Date(at).toISOString();
  const findings: WorkflowFinding[] = [];
  const add = (code: string, severity: FindingSeverity, title: string, guidance: string) => {
    if (!findings.some(f => f.code === code)) findings.push({ code, severity, title, guidance });
  };

  const msaTrusted = validScope(workflow, msa, workflow.msa_job_id, "multiple_sequence_alignment");
  const treeId = workflow.phylogeny_job_id;
  const treeTrusted = treeId !== null && validScope(workflow, phylogeny, treeId, "phylogenetic_tree");
  const trustedMsa = msaTrusted ? msa : null;
  const trustedTree = treeTrusted ? phylogeny : null;

  if (!msaTrusted) add("msa_unavailable", "critical", "MSA evidence is unavailable",
    "Check authorization and the source scientific job record; do not force a downstream dispatch.");
  if (treeId && !treeTrusted) add("tree_unavailable", "critical", "Tree evidence is unavailable",
    "Review the referenced phylogenetic job and its project scope before acting.");

  let lineage: WorkflowDiagnostic["lineage"] = "pending";
  if (treeId && trustedTree && trustedMsa) {
    const validDependency = dependency !== null &&
      dependency.job_id === treeId &&
      dependency.dependency_job_id === workflow.msa_job_id &&
      dependency.organization_id === workflow.organization_id &&
      dependency.project_id === workflow.project_id &&
      dependency.dependency_role === "source_msa";
    const hashMatches = trustedMsa.status === "completed" &&
      typeof trustedMsa.result_sha256 === "string" && SHA_RE.test(trustedMsa.result_sha256) &&
      validDependency && dependency.dependency_result_sha256 === trustedMsa.result_sha256;
    lineage = hashMatches ? "verified_metadata" : "mismatch";
    if (!hashMatches) add("lineage_mismatch", "critical", "Scientific dependency provenance disagrees",
      "Compare the MSA's recorded SHA-256 and the tree's dependency record. Do not reuse unverified downstream results.");
  } else if (treeId) {
    lineage = "unavailable";
  }

  if (treeId && trustedMsa?.status !== "completed") {
    add("premature_tree", "critical", "Tree was linked before MSA completion",
      "Review the workflow handoff and authoritative job statuses before trusting the tree.");
  }
  if (workflow.status === "running") {
    if (trustedMsa && FINISHED.has(trustedMsa.status) && trustedMsa.status !== "completed") {
      add("failed_prerequisite", "critical", "Workflow still running after MSA failed",
        "Review the MSA failure and workflow status transition; an automatic rerun is not safe.");
    }
    if (trustedMsa?.status === "completed" && !treeId) {
      add("handoff_missing", "critical", "MSA finished but no tree job is linked",
        "Check the server-side handoff trigger, rate limits and audit trail. Do not manually resubmit without verifying idempotency.");
    }
    if (trustedTree && FINISHED.has(trustedTree.status)) {
      add("unfinalized_workflow", "critical", "Tree finished but workflow remains running",
        "Review the workflow state-transition trigger and associated audit event.");
    }
    const current: ScientificStep | null = treeId ? trustedTree : trustedMsa;
    if (current && ACTIVE.has(current.status)) {
      const elapsedSeconds = current.status === "queued"
        ? elapsed(at, current.created_at)
        : elapsed(at, current.processing_started_at ?? current.updated_at);
      const threshold = current.status === "queued" ? 300 : 900;
      if (elapsedSeconds !== null && elapsedSeconds > threshold) {
        add("long_running_step", "attention", "Scientific step exceeds monitoring threshold",
          "Check live worker and queue health. Longer execution is not by itself proof that the job is stuck.");
      }
    }
  } else if (!FINISHED.has(workflow.status)) {
    add("unknown_workflow_status", "critical", "Workflow status is not recognized",
      "Investigate the authoritative workflow lifecycle before using these results.");
  } else if (workflow.status === "completed") {
    if (!trustedMsa || trustedMsa.status !== "completed" ||
        !trustedTree || trustedTree.status !== "completed" || lineage !== "verified_metadata") {
      add("false_completion", "critical", "Workflow completion is not supported by step evidence",
        "Inspect both scientific jobs and their dependency hash before relying on this workflow.");
    }
  } else if (workflow.status === "error" || workflow.status === "cancelled") {
    if ((trustedMsa && ACTIVE.has(trustedMsa.status)) || (trustedTree && ACTIVE.has(trustedTree.status))) {
      add("terminal_with_active_job", "attention", "Terminal workflow still has an active step",
        "Review job progress before starting any new scientific analysis.");
    }
  }
  if (FINISHED.has(workflow.status) && !workflow.finished_at) {
    add("missing_finish_time", "attention", "Terminal workflow has no completion timestamp",
      "Confirm the workflow record was finalized through the expected database transition.");
  }
  if (workflow.status === "running" && workflow.finished_at !== null) {
    add("running_with_finish_time", "critical", "Running workflow has a terminal timestamp",
      "Check lifecycle constraints and workflow state consistency.");
  }
  const needsReview = findings.some(f => f.severity !== "info");
  const state: WorkflowDiagnostic["state"] = findings.some(f => f.severity === "critical")
    ? "inconsistent"
    : workflow.status === "running" ? "running"
    : workflow.status === "completed" ? "completed"
    : workflow.status === "cancelled" ? "cancelled" : "error";
  const phase: WorkflowDiagnostic["stage"] = workflow.status === "completed" ? "finished"
    : treeId ? "phylogeny"
    : trustedMsa?.status === "completed" ? "handoff" : "msa";
  const headline = state === "inconsistent" ? "Reconciliation needs review"
    : state === "completed" ? "Both scientific steps completed"
    : state === "error" ? "Workflow ended with an error"
    : state === "cancelled" ? "Workflow was cancelled"
    : phase === "phylogeny" ? "Phylogenetic analysis in progress"
    : phase === "handoff" ? "Preparing the phylogenetic step"
    : "Multiple sequence alignment in progress";

  return {
    workflowId: workflow.id,
    conversationId: workflow.conversation_id,
    projectId: workflow.project_id,
    state, headline, stage: phase,
    stages: [stage(trustedMsa, workflow.msa_job_id, "MAFFT multiple alignment"),
      stage(trustedTree, treeId, "FastTree phylogenetic analysis")],
    lineage, findings, needsReview, refreshing: workflow.status === "running" && !needsReview,
    observedAt,
  };
}
