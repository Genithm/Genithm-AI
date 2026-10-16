/** Human-readable, non-fabricated summaries of persisted scientific work.
 * A status is only an execution state, NOT scientific evidence validation.
 */
export type ActivityKind = "scientific" | "pipeline";
export type ActivityState = "active" | "completed" | "stopped" | "unknown";
export type ActivityFilter = "all" | "active" | "completed" | "stopped";
export type ActivityScope = "all" | ActivityKind;

const SCIENTIFIC_ACTIVE = ["queued", "pending", "processing", "running", "validating_result", "retry_pending"] as const;
const PIPELINE_ACTIVE = ["queued", "awaiting_source", "awaiting_validation", "running", "processing"] as const;
const TERMINAL_STOPPED = ["error", "failed", "cancelled", "canceled"] as const;

export function classifyActivity(kind: ActivityKind, status: string): ActivityState {
  if (status === "completed") return "completed";
  if ((TERMINAL_STOPPED as readonly string[]).includes(status)) return "stopped";
  if ((kind === "scientific" ? SCIENTIFIC_ACTIVE : PIPELINE_ACTIVE as readonly string[]).includes(status)) return "active";
  return "unknown";
}

export function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    queued: "Queued", pending: "Pending", processing: "Processing",
    running: "Running", validating_result: "Validating result",
    awaiting_source: "Awaiting source", awaiting_validation: "Validating input",
    retry_pending: "Retry pending", completed: "Completed",
    error: "Error", failed: "Failed", cancelled: "Cancelled", canceled: "Cancelled",
  };
  return labels[status] ?? "Status unavailable";
}

export function activityTitle(kind: ActivityKind, type: string): string {
  if (kind === "pipeline") {
    if (type === "ncbi_nucleotide_orf_v1") return "NCBI nucleotide → ORF scan";
    if (type === "ncbi_protein_profile_v1") return "NCBI protein profile";
    return "Scientific pipeline";
  }
  const titles: Record<string, string> = {
    pairwise_alignment: "Pairwise alignment",
    multiple_sequence_alignment: "Multiple sequence alignment",
    phylogenetic_tree: "Phylogenetic tree",
    protein_properties: "Protein properties",
    sequence_insights: "Sequence insights",
  };
  return titles[type] ?? "Scientific analysis";
}

export function activityFilter(raw: string | undefined): ActivityFilter | null {
  if (!raw || raw === "all") return "all";
  return raw === "active" || raw === "completed" || raw === "stopped" ? raw : null;
}

export function activityScope(raw: string | undefined): ActivityScope | null {
  if (!raw || raw === "all") return "all";
  return raw === "scientific" || raw === "pipeline" ? raw : null;
}

export function statusQueryFilter(kind: ActivityKind, filter: ActivityFilter): readonly string[] | null {
  if (filter === "all") return null;
  if (filter === "completed") return ["completed"];
  if (filter === "stopped") return TERMINAL_STOPPED;
  return kind === "scientific" ? SCIENTIFIC_ACTIVE : PIPELINE_ACTIVE;
}

export type ActivityRow = {
  id: string;
  kind: ActivityKind;
  projectId: string;
  projectName: string;
  title: string;
  status: string;
  createdAt: string;
  /** A stored scientific result fingerprint; not an independent verification. */
  resultSha256: string | null;
  href: string;
};

export function sortActivityRows(rows: ActivityRow[]): ActivityRow[] {
  return [...rows].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)
  );
}
