/**
 * Science V12 — verified multi-report dossier assembly.
 *
 * Each item MUST be returned by the existing owner-scoped
 * get_scientific_report() RPC with integrity_valid=true. This layer does not
 * manufacture scientific findings or re-interpret recorded evidence.
 */
export const DOSSIER_MIN_REPORTS = 2;
export const DOSSIER_MAX_REPORTS = 8;
export const DOSSIER_MAX_SINGLE_REPORT_CHARS = 512_000;
export const DOSSIER_MAX_TOTAL_SNAPSHOT_CHARS = 2_000_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA = /^[a-f0-9]{64}$/;
const SOURCES = new Set(["scientific_job", "blast_job", "sequence_retrieval", "protein_annotation_job"]);
const MEASURES: ReadonlyArray<[string, string, string]> = [
  ["identity_percent", "Identity", "%"],
  ["aligned_length", "Aligned length", "positions"],
  ["matches", "Aligned matches", "positions"],
  ["mismatches", "Aligned mismatches", "positions"],
  ["gaps", "Gap columns", "positions"],
  ["sequence_count", "Sequences", ""],
  ["leaf_count", "Phylogeny leaves", ""],
  ["internal_support_count", "Supported nodes", ""],
  ["length", "Protein length", "aa"],
  ["molecular_weight_da", "Molecular weight", "Da"],
  ["estimated_isoelectric_point", "Estimated pI", ""],
  ["motif_hits", "Reported motif hits", ""],
] as const;

export type SealedReport = {
  id: string;
  project_id: string;
  source_resource_type: string;
  source_resource_id: string;
  source_job_type: string | null;
  report_schema_version: string;
  report_sha256: string;
  source_evidence_sha256: string | null;
  source_result_sha256: string | null;
  generated_at: string;
  report_snapshot: unknown;
  integrity_valid: boolean;
};

export type DossierReport = {
  report_id: string;
  source_type: string;
  source_id: string;
  source_subtype: string | null;
  report_schema: string;
  report_sha256: string;
  source_evidence_sha256: string | null;
  generated_at: string;
  snapshot: Record<string, unknown>;
};

export type DossierComparison = {
  key: string;
  label: string;
  unit: string;
  values: Array<number | null>;
};
export type DossierPayload = {
  schema_version: "genithm-research-dossier/1";
  project_id: string;
  reports: DossierReport[];
};
export type Dossier = {
  payload: DossierPayload;
  comparison: DossierComparison[];
  canonical_payload_sha256: string;
  report_count: number;
};

export class DossierValidationError extends Error {
  constructor(message: string) { super(message); this.name = "DossierValidationError"; }
}
function expect(value: unknown, message: string): asserts value {
  if (!value) throw new DossierValidationError(message);
}
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function normalizeIds(ids: readonly string[]): string[] {
  expect(ids.length >= DOSSIER_MIN_REPORTS && ids.length <= DOSSIER_MAX_REPORTS,
    "A research dossier requires 2 to 8 distinct reports.");
  expect(ids.every(id => UUID.test(id)), "Invalid report identifier.");
  const clean = ids.map(id => id.toLowerCase());
  expect(new Set(clean).size === clean.length, "Duplicate report identifier.");
  return clean.sort();
}
/** Validate before issuing any DB queries or loading private scientific data. */
export function validateDossierSelection(projectId: string, ids: readonly string[]) {
  expect(UUID.test(projectId), "Invalid project identifier.");
  return { projectId: projectId.toLowerCase(), reportIds: normalizeIds(ids) };
}

export function canonicalDossierJson(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonicalDossierJson).join(",") + "]";
  if (object(value)) {
    return "{" + Object.keys(value).sort().map(k =>
      JSON.stringify(k) + ":" + canonicalDossierJson(value[k])).join(",") + "}";
  }
  if (value === null || typeof value === "string" || typeof value === "boolean" ||
      typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  throw new DossierValidationError("Noncanonical dossier value.");
}
async function sha256(text: string) {
  const bytes = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, "0")).join("");
}
function numericMeasures(snapshot: Record<string, unknown>) {
  const summary = object(snapshot.result_summary) ? snapshot.result_summary : {};
  const values = new Map<string, number>();
  for (const [key] of MEASURES) {
    const value = summary[key];
    if (typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 1e12) {
      values.set(key, value);
    }
  }
  return values;
}

export async function assembleDossier(
  projectId: string,
  selectedIds: readonly string[],
  reportRows: readonly SealedReport[],
): Promise<Dossier> {
  const selection = validateDossierSelection(projectId, selectedIds);
  expect(reportRows.length === selection.reportIds.length, "Reports are missing or unauthorized.");
  const byId = new Map<string, SealedReport>();
  for (const row of reportRows) {
    expect(UUID.test(row.id) && !byId.has(row.id.toLowerCase()),
      "Duplicate or malformed report record.");
    byId.set(row.id.toLowerCase(), row);
  }
  let totalSnapshotLength = 0;
  const reports: DossierReport[] = selection.reportIds.map(id => {
    const row = byId.get(id);
    expect(row, "One or more selected reports are missing or unauthorized.");
    expect(row.integrity_valid === true, "One or more scientific report seals failed verification.");
    expect(UUID.test(row.project_id) && row.project_id.toLowerCase() === selection.projectId,
      "Report does not belong to the selected project.");
    expect(SOURCES.has(row.source_resource_type) && UUID.test(row.source_resource_id),
      "Report contains an unsupported scientific source.");
    expect(SHA.test(row.report_sha256), "Report has an invalid seal digest.");
    expect(row.source_evidence_sha256 === null || SHA.test(row.source_evidence_sha256),
      "Report source digest is invalid.");
    expect(row.source_result_sha256 === null || SHA.test(row.source_result_sha256),
      "Report result digest is invalid.");
    expect(typeof row.report_schema_version === "string" && row.report_schema_version.length <= 100,
      "Invalid report schema.");
    expect(typeof row.generated_at === "string" && Number.isFinite(Date.parse(row.generated_at)),
      "Invalid report generation timestamp.");
    expect(object(row.report_snapshot), "Report snapshot is invalid.");

    // Snapshot JSON from the trusted database RPC is JSONB, so only standard
    // canonical JSON types are accepted. The size cap prevents export abuse.
    const snapshotText = canonicalDossierJson(row.report_snapshot);
    const snapshotBytes = new TextEncoder().encode(snapshotText).byteLength;
    expect(snapshotBytes <= DOSSIER_MAX_SINGLE_REPORT_CHARS, "Report is too large to bundle.");
    totalSnapshotLength += snapshotBytes;
    expect(totalSnapshotLength <= DOSSIER_MAX_TOTAL_SNAPSHOT_CHARS, "Dossier exceeds the export size budget.");
    const source = row.report_snapshot.source;
    const project = row.report_snapshot.project;
    expect(object(source) && object(project) &&
      project.id === row.project_id && source.resource_type === row.source_resource_type &&
      source.resource_id === row.source_resource_id, "Report snapshot identity differs from sealed metadata.");
    return {
      report_id: row.id.toLowerCase(),
      source_type: row.source_resource_type,
      source_id: row.source_resource_id.toLowerCase(),
      source_subtype: row.source_job_type,
      report_schema: row.report_schema_version,
      report_sha256: row.report_sha256,
      source_evidence_sha256: row.source_evidence_sha256,
      generated_at: row.generated_at,
      snapshot: row.report_snapshot,
    };
  });

  const payload: DossierPayload = {
    schema_version: "genithm-research-dossier/1",
    project_id: selection.projectId,
    reports,
  };
  const reportMeasurements = reports.map(r => numericMeasures(r.snapshot));
  const comparison: DossierComparison[] = MEASURES.map(([key, label, unit]) => ({
    key, label, unit,
    values: reportMeasurements.map(measures => measures.get(key) ?? null),
  })).filter(row => row.values.some(x => x !== null));
  return {
    payload, comparison, report_count: reports.length,
    canonical_payload_sha256: await sha256(canonicalDossierJson(payload)),
  };
}

export function renderDossierMarkdown(dossier: Dossier, projectName: string): string {
  const safe = (value: string) => value.replace(/[|\r\n]/g, " ").slice(0, 130);
  const { payload, comparison } = dossier;
  return [
    "# Genithm Research Dossier",
    "",
    "## Provenance",
    "",
    "- Project: " + safe(projectName),
    "- Project ID: " + payload.project_id,
    "- Schema: " + payload.schema_version,
    "- Reports: " + payload.reports.length,
    "- Canonical payload SHA-256: " + dossier.canonical_payload_sha256,
    "- Canonicalization: recursive lexicographically sorted JSON object keys, compact JSON; UTF-8 SHA-256",
    "",
    "This digest covers the dossier payload (including all report snapshots). Individual report",
    "seals were verified by the authorized database RPC before dossier assembly.",
    "It is a checksum, not a signature, proof of biological correctness or source freshness.",
    "",
    "## Sealed sources",
    "",
    ...payload.reports.flatMap((r, i) => [
      "### " + (i + 1) + ". " + safe(r.source_type.replaceAll("_", " ")),
      "",
      "- Report ID: " + r.report_id,
      "- Source ID: " + r.source_id,
      "- Report seal SHA-256: " + r.report_sha256,
      "- Source evidence SHA-256: " + (r.source_evidence_sha256 ?? "not recorded"),
      "- Generated: " + r.generated_at,
      "",
    ]),
    "## Side-by-side recorded measurements",
    "",
    "| Measurement | " + payload.reports.map((_, i) => "Report " + (i + 1)).join(" | ") + " |",
    "| --- | " + payload.reports.map(() => "---:").join(" | ") + " |",
    ...comparison.map(r => "| " + safe(r.label + (r.unit ? " (" + r.unit + ")" : "")) +
      " | " + r.values.map(v => v === null ? "—" : String(v)).join(" | ") + " |"),
    "",
    "Measurements remain source-specific. Blank cells indicate unavailable metrics.",
    "Do not compare numbers from incompatible methods as if they measured the same phenomenon.",
    "",
    "## Scientific interpretation policy",
    "",
    "This dossier reproduces recorded scientific results. No AI interpretation or claims",
    "of causation, functional equivalence, biological significance or statistical confidence",
    "have been added. Refer to each sealed snapshot for methods, limitations and provenance.",
    "",
  ].join("\n");
}
