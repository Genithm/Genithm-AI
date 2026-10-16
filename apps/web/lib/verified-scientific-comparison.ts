import type { ExplorerResult } from "./scientific-result-explorer";

export type ComparableJobType = "protein_properties" | "pairwise_alignment";
export type ComparableView = Extract<ExplorerResult, { kind: "protein" | "pairwise" }>;

export type VerifiedComparisonRun = {
  id: string;
  jobType: ComparableJobType;
  sha256: string;
  toolVersion: string;
  view: ComparableView;
};

export type ComparisonMetric = {
  key: string;
  label: string;
  unit: string;
  values: number[];
};

export type VerifiedComparison = {
  kind: ComparableJobType;
  runs: VerifiedComparisonRun[];
  metrics: ComparisonMetric[];
  description: string;
};

const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const SHA = /^[0-9a-f]{64}$/;
const RESIDUES = "ACDEFGHIKLMNPQRSTVWY";

export function parseComparisonIds(raw: unknown): string[] | null {
  if (typeof raw !== "string" || raw.length > 160) return null;
  const ids = raw.split(",");
  if (ids.length < 2 || ids.length > 4 || !ids.every(id => UUID.test(id))) return null;
  if (new Set(ids.map(id => id.toLowerCase())).size !== ids.length) return null;
  return ids;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
function nonnegativeInt(value: unknown): value is number {
  return finite(value) && Number.isSafeInteger(value) && value >= 0;
}
function guard(ok: boolean, message: string): asserts ok {
  if (!ok) throw new Error(message);
}

export function buildVerifiedComparison(rows: VerifiedComparisonRun[]): VerifiedComparison {
  guard(rows.length >= 2 && rows.length <= 4, "Compare between two and four results.");
  const ids = new Set<string>();
  const kind = rows[0].jobType;
  guard(kind === "protein_properties" || kind === "pairwise_alignment", "This analysis is not supported for comparison.");
  for (const run of rows) {
    guard(UUID.test(run.id) && SHA.test(run.sha256), "Invalid scientific result reference.");
    guard(!ids.has(run.id.toLowerCase()), "Select distinct scientific results.");
    ids.add(run.id.toLowerCase());
    guard(run.jobType === kind, "Select analyses of the same type.");
    guard(typeof run.toolVersion === "string" && run.toolVersion.length <= 100, "Invalid tool version.");
    if (kind === "protein_properties") {
      guard(run.view.kind === "protein" && nonnegativeInt(run.view.length) && run.view.length > 0,
        "Protein result dimensions are invalid.");
      const seen = new Set<string>();
      let total = 0;
      for (const residue of run.view.composition) {
        guard(RESIDUES.includes(residue.residue) && residue.residue.length === 1 &&
          !seen.has(residue.residue) && nonnegativeInt(residue.count),
          "Protein residue count is invalid.");
        seen.add(residue.residue);
        total += residue.count;
      }
      guard(total === run.view.length, "Protein composition does not match the recorded length.");
      const propertyLabels = new Set<string>();
      for (const property of run.view.properties) {
        guard(finite(property.value) && !propertyLabels.has(property.label),
          "Scientific property is invalid.");
        propertyLabels.add(property.label);
      }
    } else {
      guard(run.view.kind === "pairwise" && nonnegativeInt(run.view.total) &&
        run.view.total > 0 && nonnegativeInt(run.view.match) &&
        nonnegativeInt(run.view.mismatch) && nonnegativeInt(run.view.gaps) &&
        run.view.match + run.view.mismatch + run.view.gaps <= run.view.total,
        "Pairwise alignment counts are inconsistent.");
    }
  }

  if (kind === "pairwise_alignment") {
    const aligned = rows.map(row => row.view as Extract<ComparableView, { kind: "pairwise" }>);
    return {
      kind, runs: rows,
      description: "Alignment column counts, not evolutionary or functional similarity. " +
        "Exact-match fraction is matches divided by all aligned columns, including gap columns.",
      metrics: [
        { key: "aligned_columns", label: "Aligned columns", unit: "columns", values: aligned.map(v => v.total) },
        { key: "matches", label: "Exact matches", unit: "columns", values: aligned.map(v => v.match) },
        { key: "mismatches", label: "Mismatches", unit: "columns", values: aligned.map(v => v.mismatch) },
        { key: "gap_columns", label: "Gap columns", unit: "columns", values: aligned.map(v => v.gaps) },
        { key: "match_fraction", label: "Exact-match fraction", unit: "%", values: aligned.map(v => 100 * v.match / v.total) },
      ],
    };
  }

  const proteins = rows.map(row => row.view as Extract<ComparableView, { kind: "protein" }>);
  const propertyLabels = [
    "Molecular weight (Da)", "Aromaticity", "GRAVY",
    "Estimated charge (pH 7)", "Estimated pI",
  ];
  const common = propertyLabels.filter(label => proteins.every(p =>
    p.properties.some(prop => prop.label === label)));
  const metrics: ComparisonMetric[] = [
    { key: "length", label: "Protein length", unit: "aa", values: proteins.map(p => p.length) },
    ...common.map(label => ({
      key: label.toLowerCase().replaceAll(/[^a-z0-9]+/g, "_"),
      label, unit: label === "Molecular weight (Da)" ? "Da" : label === "Aromaticity" ? "fraction" : "model estimate",
      values: proteins.map(p => p.properties.find(prop => prop.label === label)!.value),
    })),
    ...[...RESIDUES].map(residue => ({
      key: "residue_" + residue, label: residue + " residue frequency", unit: "%",
      values: proteins.map(p => 100 * (p.composition.find(r => r.residue === residue)?.count ?? 0) / p.length),
    })),
  ];
  return {
    kind, runs: rows, metrics,
    description: "Composition frequencies are observed residue counts divided by protein length. " +
      "Charge, pI, hydropathy and related properties are computational model estimates; " +
      "different tool versions may not be directly comparable.",
  };
}

export function formatComparisonNumber(value: number): string {
  if (!finite(value)) throw new Error("Invalid numerical result.");
  return Number(value.toPrecision(9)).toString();
}

/** Export only verified projected values, never raw unverified result summaries. */
export function verifiedComparisonTsv(comparison: VerifiedComparison): string {
  // Only call this after buildVerifiedComparison has accepted the projected runs.
  const headers = ["Metric", "Unit", ...comparison.runs.map((_, i) => "Run " + (i + 1))];
  const record = (cells: string[]) => cells.map(cell => {
    const safe = cell.replaceAll(/[\r\n\t]/g, " ");
    // Spreadsheet tools may evaluate leading formula operators in metadata.
    // Keep real numeric negative values numeric; escape nonnumeric formulas.
    return /^[=+@]|^-(?!\d+(?:\.\d+)?(?:e[+-]?\d+)?$)/i.test(safe)
      ? "'" + safe : safe;
  }).join("\t");
  return [
    record(["Genithm verified scientific comparison"]),
    record(["Job type", comparison.kind]),
    record(["Result SHA-256", "", ...comparison.runs.map(r => r.sha256)]),
    record(["Scientific job ID", "", ...comparison.runs.map(r => r.id)]),
    record(["Tool version", "", ...comparison.runs.map(r => r.toolVersion)]),
    record(["Verification", "", ...comparison.runs.map(() => "sha256-verified")]),
    "",
    record(headers),
    ...comparison.metrics.map(metric => record([
      metric.label, metric.unit, ...metric.values.map(formatComparisonNumber),
    ])),
    "",
    record(["Interpretation boundary", comparison.description]),
    "",
  ].join("\n");
}
