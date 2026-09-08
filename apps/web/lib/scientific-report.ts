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

function pretty(value: Json | undefined) {
  return JSON.stringify(value ?? {}, null, 2);
}

function text(value: Json | undefined) {
  return typeof value === "string" ? value : value == null ? "n/a" : String(value);
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderScientificReportMarkdown(snapshotValue: Json) {
  const snapshot = asRecord(snapshotValue);
  const project = asRecord(snapshot.project);
  const source = asRecord(snapshot.source);
  const tool = asRecord(snapshot.tool);
  const policy = asRecord(snapshot.interpretation_policy);
  const title = reportJobTitle(text(source.job_type));

  return [
    `# Genithm Scientific Report — ${title}`,
    "",
    `- Report schema: ${text(snapshot.schema_version)}`,
    `- Project: ${text(project.name)} (${text(project.id)})`,
    `- Source job: ${text(source.resource_id)}`,
    `- Source result SHA-256: ${text(source.result_sha256)}`,
    `- Completed at: ${text(source.completed_at)}`,
    `- Tool: ${text(tool.id)} ${text(tool.version)}`,
    `- Executor: ${text(tool.executor_version)}`,
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
  const tool = asRecord(snapshot.tool);
  const policy = asRecord(snapshot.interpretation_policy);
  const title = reportJobTitle(text(source.job_type));
  const section = (heading: string, value: Json | undefined) =>
    `<section><h2>${escapeHtml(heading)}</h2><pre>${escapeHtml(pretty(value))}</pre></section>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(`Genithm Scientific Report — ${title}`)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:960px;margin:40px auto;padding:0 20px;line-height:1.5;color:#111}code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f4f4f4;padding:16px;border-radius:8px}.meta{display:grid;gap:6px;margin:20px 0}.seal{border:1px solid #bbb;padding:14px;border-radius:8px}</style>
</head>
<body>
<header><p>Genithm · authoritative scientific result</p><h1>${escapeHtml(title)}</h1></header>
<div class="meta">
<div><strong>Schema:</strong> ${escapeHtml(text(snapshot.schema_version))}</div>
<div><strong>Project:</strong> ${escapeHtml(text(project.name))} (${escapeHtml(text(project.id))})</div>
<div><strong>Source job:</strong> ${escapeHtml(text(source.resource_id))}</div>
<div><strong>Source result SHA-256:</strong> <code>${escapeHtml(text(source.result_sha256))}</code></div>
<div><strong>Completed:</strong> ${escapeHtml(text(source.completed_at))}</div>
<div><strong>Tool:</strong> ${escapeHtml(text(tool.id))} ${escapeHtml(text(tool.version))}</div>
<div><strong>Executor:</strong> ${escapeHtml(text(tool.executor_version))}</div>
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
