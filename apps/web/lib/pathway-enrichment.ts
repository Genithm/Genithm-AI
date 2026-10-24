/** V56: valid, self-contained gene-set over-representation (ORA) by exact
 * hypergeometric right-tail with an explicit measured-gene background.
 * No external gene annotations are claimed: researchers provide GMT.
 */
import {benjaminiHochberg, safeTsv} from "./research-statistics.ts";
export const PATHWAY_VERSION = "genithm-pathway-ora/1.0.0";
export const MAX_PATHWAY_GMT_BYTES = 8 * 1024 * 1024;
export const MAX_PATHWAY_LIST_BYTES = 1024 * 1024;
export const MAX_PATHWAY_SETS = 10000;
export const MAX_PATHWAY_GENES = 50000;
const geneId = /^[A-Za-z0-9][A-Za-z0-9_.:\-]{0,127}$/;
const setName = /^[A-Za-z0-9][A-Za-z0-9_.:\-]{0,127}$/;
export class PathwayInputError extends Error {
  constructor(message: string) {super(message); this.name = "PathwayInputError";}
}
function requireInput(value: unknown, message: string): asserts value {
  if (!value) throw new PathwayInputError(message);
}
function textRows(text: string, name: string, max: number): string[] {
  requireInput(text.length > 0 && text.length <= max && !text.includes("\0"),
    `${name} must be nonempty, uncompressed UTF-8 text within ${max} characters.`);
  return text.replace(/^\uFEFF/, "").split(/\r\n|\n|\r/).filter(x => x.trim().length > 0 && !x.startsWith("#"));
}
export function geneList(text: string, label: string): Set<string> {
  const rows = textRows(text, label, MAX_PATHWAY_LIST_BYTES);
  const ids = new Set<string>();
  for (const [index, row] of rows.entries()) {
    const id = row.trim();
    if (index === 0 && /^gene(?:_id)?$/i.test(id)) continue;
    requireInput(geneId.test(id), `${label}: invalid gene ID at line ${index + 1}. Use one ID per line.`);
    requireInput(!ids.has(id), `${label}: duplicate gene ID ${id}.`);
    ids.add(id);
    requireInput(ids.size <= MAX_PATHWAY_GENES, `${label} exceeds ${MAX_PATHWAY_GENES} genes.`);
  }
  requireInput(ids.size > 0, `${label} has no gene IDs.`);
  return ids;
}
export type PathwayRow = {
  name: string; setSize: number; querySize: number; overlap: number;
  expectedOverlap: number; enrichmentRatio: number; p: number; fdr: number; overlapGenes: string[];
};
export type PathwayResult = {
  schema: "genithm-pathway-ora/1"; version: string; method: string;
  universeGenes: number; inputSelectedGenes: number; pathwaySetsSeen: number;
  eligibleSetsTested: number; excludedSets: Record<string, number>; pathways: PathwayRow[];
  warnings: string[];
};

/** Right tail P(X >= overlap) for the hypergeometric distribution, computed
 * using stable log probabilities; all eligible pathways including zero hits
 * must count toward BH-FDR, avoiding selection-conditioned multiplicity.
 */
export function hypergeometricUpperTail(N: number, K: number, draws: number, overlap: number,
  cachedLogFactorials?: Float64Array): number {
  for (const v of [N, K, draws, overlap]) if (!Number.isInteger(v)) throw new PathwayInputError("Hypergeometric counts must be integers.");
  requireInput(N >= 1 && K >= 0 && K <= N && draws >= 0 && draws <= N && overlap >= 0 && overlap <= Math.min(K, draws),
    "Invalid population, pathway, selected, or overlap counts.");
  if (overlap <= Math.max(0, draws - (N - K))) return 1;
  const logs = cachedLogFactorials ?? new Float64Array(N + 1);
  requireInput(logs.length === N + 1, "Factorial cache size differs from the gene universe.");
  if (!cachedLogFactorials) for (let i = 2; i <= N; i++) logs[i] = logs[i - 1] + Math.log(i);
  const logChoose = (n: number, k: number) => k < 0 || k > n ? -Infinity : logs[n] - logs[k] - logs[n - k];
  const denominator = logChoose(N, draws);
  const upper = Math.min(K, draws);
  let logTerm = logChoose(K, overlap) + logChoose(N - K, draws - overlap) - denominator;
  let highest = logTerm, scaledSum = 1;
  for (let i = overlap; i < upper; i++) {
    const numerator = (K - i) * (draws - i);
    const divisor = (i + 1) * (N - K - draws + i + 1);
    if (numerator <= 0) break;
    requireInput(divisor > 0, "Invalid hypergeometric recurrence.");
    logTerm += Math.log(numerator) - Math.log(divisor);
    if (logTerm > highest) { scaledSum = 1 + scaledSum * Math.exp(highest - logTerm); highest = logTerm; }
    else scaledSum += Math.exp(logTerm - highest);
  }
  return Math.max(1e-300, Math.min(1, Math.exp(highest + Math.log(scaledSum))));
}

export function analyzePathways(selectedText: string, universeText: string, gmtText: string,
  onProgress?: (sets: number) => void): PathwayResult {
  const selected = geneList(selectedText, "Selected genes");
  const universe = geneList(universeText, "Background universe");
  requireInput(universe.size >= 20 && selected.size <= 5000 && selected.size <= universe.size,
    "Provide 20–50,000 measured background genes and at most 5,000 selected genes.");
  for (const id of selected) requireInput(universe.has(id),
    `Selected gene ${id} is absent from the measured background. Do not substitute an assumed whole-genome universe.`);
  const rows = textRows(gmtText, "GMT gene sets", MAX_PATHWAY_GMT_BYTES);
  requireInput(rows.length > 0 && rows.length <= MAX_PATHWAY_SETS,
    `GMT must have 1–${MAX_PATHWAY_SETS} gene-set lines.`);
  const uniqueNames = new Set<string>(); const tested: PathwayRow[] = [];
  // Allocate a single factorial cache for the entire GMT catalog; per-set
  // recomputation would scale as O(universe * pathways) and stall large input.
  const logFactorials = new Float64Array(universe.size + 1);
  for (let i = 2; i <= universe.size; i++) logFactorials[i] = logFactorials[i - 1] + Math.log(i);
  const excludedSets = {too_small: 0, too_large: 0, not_in_universe: 0};
  for (const [line, row] of rows.entries()) {
    const fields = row.split("\t").map(x => x.trim());
    requireInput(fields.length >= 3 && setName.test(fields[0]) && fields[1].length <= 1000,
      `GMT line ${line + 1} requires a short set name, description and gene IDs separated by tabs.`);
    requireInput(!uniqueNames.has(fields[0]), `Duplicate GMT set: ${fields[0]}.`);
    uniqueNames.add(fields[0]);
    const members = new Set<string>();
    for (const name of fields.slice(2)) {
      requireInput(geneId.test(name) && !members.has(name), `GMT ${fields[0]} has invalid or repeated gene members.`);
      members.add(name);
    }
    if (members.size > 5000) {excludedSets.too_large++; continue;}
    const effective = [...members].filter(x => universe.has(x));
    if (!effective.length) {excludedSets.not_in_universe++; continue;}
    if (effective.length < 3) {excludedSets.too_small++; continue;}
    if (effective.length > 2000 || effective.length === universe.size) {excludedSets.too_large++; continue;}
    const overlapGenes = effective.filter(x => selected.has(x)).sort();
    const p = overlapGenes.length
      ? hypergeometricUpperTail(universe.size, effective.length, selected.size, overlapGenes.length, logFactorials)
      : 1;
    const expected = effective.length * selected.size / universe.size;
    tested.push({name: fields[0], setSize: effective.length, querySize: selected.size,
      overlap: overlapGenes.length, expectedOverlap: expected,
      enrichmentRatio: expected > 0 ? overlapGenes.length / expected : 0,
      p, fdr: 1, overlapGenes});
    if ((line + 1) % 300 === 0) onProgress?.(line + 1);
  }
  requireInput(tested.length > 0, "No gene sets overlap the measured universe at a valid size; no pathways were tested.");
  const adjusted = benjaminiHochberg(tested.map(x => x.p));
  for (let i = 0; i < tested.length; i++) tested[i].fdr = adjusted[i];
  tested.sort((a, b) => a.p - b.p || a.name.localeCompare(b.name));
  return {schema: "genithm-pathway-ora/1", version: PATHWAY_VERSION,
    method: "One-sided exact hypergeometric over-representation, explicit measured-gene universe; BH FDR across ALL eligible gene sets",
    universeGenes: universe.size, inputSelectedGenes: selected.size, pathwaySetsSeen: rows.length,
    eligibleSetsTested: tested.length, excludedSets, pathways: tested,
    warnings: ["Associations are conditional on your selected gene IDs, provided GMT and measured background, not proof of biological causality.",
      "Gene-set overlaps are not independent; BH FDR is a convenient exploratory correction. Gene identifier namespace and annotation quality must match."]};
}
export function pathwaysTsv(result: PathwayResult): string {
  return ["set_name\tuniverse_size\tset_size_in_universe\tselected_genes\toverlap\texpected_overlap\tenrichment_ratio\tpvalue\tpadj_BH\toverlapping_gene_ids",
    ...result.pathways.map(x => [safeTsv(x.name), result.universeGenes, x.setSize, x.querySize, x.overlap,
      x.expectedOverlap, x.enrichmentRatio, x.p, x.fdr, x.overlapGenes.map(safeTsv).join(";")].join("\t"))].join("\n") + "\n";
}
