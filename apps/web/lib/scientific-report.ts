import type { Json } from "@/lib/report-database.types";

export type ReportRecord = Record<string, Json | undefined>;

export function asRecord(value: Json | null | undefined): ReportRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as ReportRecord)
    : {};
}

export function reportJobTitle(jobType: string) {
  if (jobType === "multiple_sequence_alignment") return "Multiple Sequence Alignment";
  if (jobType === "phylogenetic_tree") return "Phylogenetic Tree";
  if (jobType === "protein_properties") return "Protein Properties";
  return "Pairwise Alignment";
}

export function reportSourceTitle(resourceType: string, subtype?: string | null) {
  if (resourceType === "scientific_job") return reportJobTitle(subtype ?? "pairwise_alignment");
  if (resourceType === "blast_job") return `${(subtype ?? "BLAST").toUpperCase()} Similarity Search`;
  if (resourceType === "sequence_retrieval") return `NCBI ${(subtype ?? "Sequence").replaceAll("_", " ")} Retrieval`;
  if (resourceType === "protein_annotation_job") return "Evidence-backed Protein Annotation";
  return "Authoritative Scientific Report";
}

export function reportSourcePath(resourceType: string, resourceId: string) {
  if (resourceType === "scientific_job") return `/dashboard/scientific-jobs/${resourceId}`;
  if (resourceType === "protein_annotation_job") return `/dashboard/protein-annotations/${resourceId}`;
  return "/dashboard";
}

function pretty(value: Json | undefined) {
  return JSON.stringify(value ?? {}, null, 2);
}

function text(value: Json | undefined) {
  return typeof value === "string" ? value : value == null ? "n/a" : String(value);
}

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

export function renderScientificReportMarkdown(snapshotValue: Json) {
  const snapshot = asRecord(snapshotValue);
  const project = asRecord(snapshot.project);
  const source = asRecord(snapshot.source);
  const policy = asRecord(snapshot.interpretation_policy);
  const title = reportSourceTitle(text(source.resource_type), text(source.subtype));

  return [
    `# Genithm Scientific Report — ${title}`,
    "",
    `- Report schema: ${text(snapshot.schema_version)}`,
    `- Project: ${text(project.name)} (${text(project.id)})`,
    `- Source type: ${text(source.resource_type)}`,
    `- Source resource: ${text(source.resource_id)}`,
    `- Source evidence SHA-256: ${text(source.evidence_sha256 ?? source.result_sha256)}`,
    `- Finalized at: ${text(source.completed_at)}`,
    "",
    "## Authoritative result summary",
    "",
    "```json",
    pretty(snapshot.result_summary),
    "```",
    "",
    "## Parameters",
    "",
    "```json",
    pretty(snapshot.parameters),
    "```",
    "",
    "## Immutable inputs",
    "",
    "```json",
    pretty(snapshot.inputs),
    "```",
    "",
    "## Workflow dependencies",
    "",
    "```json",
    pretty(snapshot.dependencies),
    "```",
    "",
    "## Provenance",
    "",
    "```json",
    pretty(snapshot.provenance),
    "```",
    "",
    "## Interpretation boundary",
    "",
    text(policy.statement),
    "",
  ].join("\n");
}

export function renderScientificReportHtml(snapshotValue: Json, reportSha256: string) {
  const snapshot = asRecord(snapshotValue);
  const project = asRecord(snapshot.project);
  const source = asRecord(snapshot.source);
  const policy = asRecord(snapshot.interpretation_policy);
  const title = reportSourceTitle(text(source.resource_type), text(source.subtype));
  const section = (heading: string, value: Json | undefined) => `<section><h2>${escapeHtml(heading)}</h2><pre>${escapeHtml(pretty(value))}</pre></section>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(`Genithm Scientific Report — ${title}`)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:960px;margin:40px auto;padding:0 20px;line-height:1.5;color:#111}code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f4f4f4;padding:16px;border-radius:8px}.meta{display:grid;gap:6px;margin:20px 0}.seal{border:1px solid #bbb;padding:14px;border-radius:8px}</style>
</head>
<body>
<header><p>Genithm · authoritative scientific evidence</p><h1>${escapeHtml(title)}</h1></header>
<div class="meta">
<div><strong>Schema:</strong> ${escapeHtml(text(snapshot.schema_version))}</div>
<div><strong>Project:</strong> ${escapeHtml(text(project.name))} (${escapeHtml(text(project.id))})</div>
<div><strong>Source type:</strong> ${escapeHtml(text(source.resource_type))}</div>
<div><strong>Source resource:</strong> ${escapeHtml(text(source.resource_id))}</div>
<div><strong>Source evidence SHA-256:</strong> <code>${escapeHtml(text(source.evidence_sha256 ?? source.result_sha256))}</code></div>
<div><strong>Finalized:</strong> ${escapeHtml(text(source.completed_at))}</div>
</div>
${section("Authoritative result summary", snapshot.result_summary)}
${section("Parameters", snapshot.parameters)}
${section("Immutable inputs", snapshot.inputs)}
${section("Workflow dependencies", snapshot.dependencies)}
${section("Provenance", snapshot.provenance)}
<section><h2>Interpretation boundary</h2><p>${escapeHtml(text(policy.statement))}</p></section>
<footer class="seal"><strong>Report SHA-256:</strong> <code>${escapeHtml(reportSha256)}</code><br>This file renders a database-sealed report snapshot. Verify integrity against the report record in Genithm.</footer>
</body>
</html>`;
}
