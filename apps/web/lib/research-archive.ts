/**
 * Science V24: stable, owner-scoped research-history pagination.
 * All input is treated as an untrusted URL locator, never authorization.
 */
export const ARCHIVE_PAGE_SIZE = 25;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// Restrict cursor grammar before injecting values into PostgREST's .or()
// expression. This excludes parentheses, commas, quotes and SQL syntax.
const PG_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;

export type ArchiveCursor = { time: string; id: string };
export type ArchiveSearch = {
  project?: string | string[];
  before_time?: string | string[];
  before_id?: string | string[];
};

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export function parseResearchArchiveSearch(search: ArchiveSearch): {
  projectId: string | null;
  cursor: ArchiveCursor | null;
  invalid: boolean;
} {
  const rawProject = search.project;
  const rawTime = search.before_time;
  const rawId = search.before_id;
  if (rawProject !== undefined && !isUuid(rawProject)) {
    return { projectId: null, cursor: null, invalid: true };
  }
  const projectId = isUuid(rawProject) ? rawProject : null;
  if (rawTime === undefined && rawId === undefined) {
    return { projectId, cursor: null, invalid: false };
  }
  if (typeof rawTime !== "string" || !PG_TIMESTAMP.test(rawTime) ||
      !Number.isFinite(Date.parse(rawTime)) || !isUuid(rawId)) {
    return { projectId, cursor: null, invalid: true };
  }
  return { projectId, cursor: { time: rawTime, id: rawId }, invalid: false };
}

export function archiveCursorPredicate(cursor: ArchiveCursor): string {
  // Only call with a parsed ArchiveCursor. Its character whitelist is checked
  // at the untrusted query boundary above.
  return `created_at.lt.${cursor.time},and(created_at.eq.${cursor.time},id.lt.${cursor.id})`;
}

export function researchArchiveHref(projectId: string | null, cursor: ArchiveCursor | null): string {
  const params = new URLSearchParams();
  if (projectId) params.set("project", projectId);
  if (cursor) {
    params.set("before_time", cursor.time);
    params.set("before_id", cursor.id);
  }
  const query = params.toString();
  return "/dashboard/ai/research" + (query ? "?" + query : "");
}

export function archiveStatus(status: string | null): string {
  switch (status) {
    case "awaiting_source": return "Awaiting NCBI retrieval";
    case "awaiting_validation": return "Awaiting FASTA validation";
    case "running": return "Running computation";
    case "completed": return "Engine completed";
    case "error": return "Engine failed";
    default: return "Status unavailable";
  }
}

export function archiveTemplate(template: string | null): string {
  switch (template) {
    case "ncbi_nucleotide_orf_v1": return "NCBI nucleotide ORF analysis";
    case "ncbi_protein_profile_v1": return "NCBI protein properties";
    default: return "Other recorded research";
  }
}
