/** Genithm V56: exploratory two-group RNA-seq count-matrix expression analysis.
 * NOTE: this is NOT DESeq2, edgeR, limma-voom, or an NB GLM. P-values use a
 * sample-level Welch test on log2-normalized CPM and are exploratory only.
 */
import {benjaminiHochberg, medianSorted, safeTsv, studentTTwoSidedP} from "./research-statistics.ts";

export const EXPRESSION_VERSION = "genithm-expression/1.0.0";
export const MAX_COUNT_BYTES = 32 * 1024 * 1024;
export const MAX_DESIGN_BYTES = 512 * 1024;
export const MAX_EXPRESSION_GENES = 50000;
export const MAX_EXPRESSION_SAMPLES = 128;
export const MAX_EXPRESSION_CELLS = 4000000;
const geneId = /^[A-Za-z0-9][A-Za-z0-9_.:\-]{0,127}$/;
const sampleId = /^[A-Za-z0-9][A-Za-z0-9_.:\-]{0,79}$/;

export class ExpressionInputError extends Error {
  constructor(message: string) { super(message); this.name = "ExpressionInputError"; }
}
function requireInput(ok: unknown, reason: string): asserts ok {
  if (!ok) throw new ExpressionInputError(reason);
}
export type ExpressionSettings = {minCpm: number; referenceGroup?: string};
export type ExpressionGene = {
  geneId: string; baseMean: number; meanReferenceCpm: number; meanComparisonCpm: number;
  log2FoldChange: number; welchT: number; degreesOfFreedom: number; p: number; fdr: number;
};
export type ExpressionSample = {sampleId: string; group: string; librarySize: number;
  sizeFactor: number; pc1: number; pc2: number};
export type ExpressionResult = {
  schema: "genithm-expression/1"; version: string; method: string;
  referenceGroup: string; comparisonGroup: string; minCpm: number;
  genesSeen: number; genesTested: number; excluded: Record<string, number>;
  samplesMatched: number; sampleGroups: Record<string, number>;
  sizeFactorMethod: string; pcaFeatures: number; pcaExplainedVariance: [number, number];
  genes: ExpressionGene[]; samples: ExpressionSample[]; warnings: string[];
};

function fileRows(value: string, label: string, maxSize: number): string[] {
  requireInput(value.length > 0 && value.length <= maxSize && !value.includes("\0"),
    `${label} must be nonempty, uncompressed UTF-8 text within its size limit.`);
  const lines = value.replace(/^\uFEFF/, "").split(/\r\n|\n|\r/).filter(x => x.trim().length > 0);
  requireInput(lines.length > 1, `${label} needs a header and data rows.`);
  return lines;
}
function cols(line: string, sep: string, label: string): string[] {
  requireInput(!line.includes('"') && !line.includes("\0"), `${label}: use unquoted CSV/TSV fields without embedded delimiters.`);
  return line.split(sep).map(s => s.trim());
}
function varianceAndMean(values: number[]): {mean: number; variance: number} {
  const mean = values.reduce((a, v) => a + v, 0) / values.length;
  const variance = values.reduce((a, v) => a + (v - mean) ** 2, 0) / (values.length - 1);
  return {mean, variance};
}
function principalComponents(samples: number, top: Array<{variance: number; centered: number[]}>): {
  axes: [number[], number[]]; explained: [number, number];
} {
  const cov = new Float64Array(samples * samples);
  const profiles = top.sort((a, b) => b.variance - a.variance).slice(0, 200);
  for (const profile of profiles) {
    const x = profile.centered;
    for (let i = 0; i < samples; i++) for (let j = i; j < samples; j++)
      cov[i * samples + j] += x[i] * x[j];
  }
  for (let i = 0; i < samples; i++) for (let j = 0; j < i; j++) cov[i * samples + j] = cov[j * samples + i];
  const trace = Array.from({length: samples}, (_, i) => cov[i * samples + i]).reduce((a, b) => a + b, 0);
  if (trace <= 1e-15) return {axes: [Array(samples).fill(0), Array(samples).fill(0)], explained: [0, 0]};
  const vectors: number[][] = []; const eigenvalues: number[] = [];
  for (let axis = 0; axis < 2; axis++) {
    let v = Array.from({length: samples}, (_, i) => Math.sin((i + 1) * (axis + 1) * 2.17));
    const normalize = (x: number[]) => {const norm = Math.sqrt(x.reduce((a, t) => a + t * t, 0)); return norm > 1e-15 ? x.map(t => t / norm) : x.map(() => 0);};
    const orthogonalize = (x: number[]) => {
      for (const prior of vectors) {
        const dp = x.reduce((s, val, i) => s + val * prior[i], 0);
        x = x.map((val, i) => val - dp * prior[i]);
      }
      return x;
    };
    v = normalize(orthogonalize(v));
    for (let iteration = 0; iteration < 100; iteration++) {
      const w = Array(samples).fill(0) as number[];
      for (let i = 0; i < samples; i++) for (let j = 0; j < samples; j++) w[i] += cov[i * samples + j] * v[j];
      const next = normalize(orthogonalize(w));
      if (Math.sqrt(next.reduce((sum, value, i) => sum + (value - v[i]) ** 2, 0)) < 1e-9) {v = next; break;}
      v = next;
    }
    const w = Array(samples).fill(0) as number[];
    for (let i = 0; i < samples; i++) for (let j = 0; j < samples; j++) w[i] += cov[i * samples + j] * v[j];
    const eigenvalue = Math.max(0, v.reduce((sum, value, i) => sum + value * w[i], 0));
    vectors.push(eigenvalue > 1e-10 ? v : Array(samples).fill(0));
    eigenvalues.push(eigenvalue);
  }
  return {axes: [vectors[0].map(v => v * Math.sqrt(eigenvalues[0])), vectors[1].map(v => v * Math.sqrt(eigenvalues[1]))],
    explained: [eigenvalues[0] / trace, eigenvalues[1] / trace]};
}

export function analyzeExpression(countsText: string, designText: string, settings: ExpressionSettings = {minCpm: 1},
  onProgress?: (genes: number) => void): ExpressionResult {
  requireInput(Number.isFinite(settings.minCpm) && settings.minCpm >= 0 && settings.minCpm <= 100, "minCpm must be between 0 and 100.");
  const designRows = fileRows(designText, "Sample design", MAX_DESIGN_BYTES);
  const dsep = designRows[0].includes("\t") ? "\t" : ",";
  const dh = cols(designRows[0], dsep, "Sample design");
  requireInput(dh.length === 2 && dh[0].toLowerCase() === "sample_id" && dh[1].toLowerCase() === "condition",
    "Sample design requires exactly sample_id and condition columns. Covariates and batches are not modeled by this exploratory test.");
  const labels = new Map<string, string>(); const groupCount = new Map<string, number>();
  for (const row of designRows.slice(1)) {
    const f = cols(row, dsep, "Sample design");
    requireInput(f.length === 2 && sampleId.test(f[0]) && sampleId.test(f[1]), "Each sample row requires a valid sample ID and condition label.");
    requireInput(!labels.has(f[0]), `Duplicate design sample: ${f[0]}.`);
    labels.set(f[0], f[1]); groupCount.set(f[1], (groupCount.get(f[1]) || 0) + 1);
  }
  requireInput(groupCount.size === 2, "Exactly two experimental conditions are required.");
  const groupNames = [...groupCount.keys()].sort((a, b) => a.localeCompare(b, "en"));
  const reference = settings.referenceGroup?.trim() || groupNames[0];
  requireInput(groupNames.includes(reference), "Reference group must match a condition in the sample sheet.");
  const comparison = groupNames.find(x => x !== reference)!;
  for (const [group, n] of groupCount) requireInput(n >= 3, `${group} needs at least three independent biological replicates.`);

  const countRows = fileRows(countsText, "Count matrix", MAX_COUNT_BYTES);
  requireInput(countRows.length >= 21 && countRows.length <= MAX_EXPRESSION_GENES + 1,
    `Count matrix must contain 20–${MAX_EXPRESSION_GENES.toLocaleString()} gene rows.`);
  const sep = countRows[0].includes("\t") ? "\t" : ",";
  const header = cols(countRows[0], sep, "Count matrix");
  requireInput(["gene_id", "gene", "geneid"].includes(header[0]?.toLowerCase()), "Count matrix must start with gene_id and sample columns.");
  const sampleNames = header.slice(1);
  requireInput(sampleNames.length >= 6 && sampleNames.length <= MAX_EXPRESSION_SAMPLES,
    "Count matrix needs 6–128 sample columns, including at least three per group.");
  requireInput(countRows.length * sampleNames.length <= MAX_EXPRESSION_CELLS,
    "Gene-by-sample count matrix exceeds the 4-million-cell browser analysis limit.");
  requireInput(sampleNames.every(s => sampleId.test(s)) && new Set(sampleNames).size === sampleNames.length,
    "Sample columns must have valid, unique IDs.");
  requireInput(labels.size === sampleNames.length && sampleNames.every(name => labels.has(name)),
    "Every count-matrix sample must appear exactly once in the design, and no extra design samples are allowed.");
  const samples = sampleNames.length;
  const ids = new Set<string>(); const raw: Array<{geneId: string; counts: number[]}> = [];
  const librarySizes = new Array<number>(samples).fill(0);
  const ratios: number[][] = Array.from({length: samples}, () => []);
  for (let row = 1; row < countRows.length; row++) {
    const f = cols(countRows[row], sep, "Count matrix");
    requireInput(f.length === samples + 1 && geneId.test(f[0]), `Row ${row + 1} must have gene_id and exactly ${samples} counts.`);
    requireInput(!ids.has(f[0]), `Duplicate gene ID: ${f[0]}.`);
    ids.add(f[0]);
    const counts = f.slice(1).map((value, index) => {
      requireInput(/^\d{1,12}$/.test(value), `${f[0]}/${sampleNames[index]} requires a nonnegative integer raw count, not CPM, decimals or NA.`);
      const number = Number(value);
      requireInput(Number.isSafeInteger(number) && number <= 1e9, `${f[0]}/${sampleNames[index]} count is out of range.`);
      librarySizes[index] += number;
      return number;
    });
    if (counts.every(c => c > 0)) {
      const geometricMean = Math.exp(counts.reduce((a, c) => a + Math.log(c), 0) / samples);
      for (let i = 0; i < samples; i++) ratios[i].push(counts[i] / geometricMean);
    }
    raw.push({geneId: f[0], counts});
    if (row % 1000 === 0) onProgress?.(row);
  }
  requireInput(ratios[0].length >= 10, "At least ten genes with positive counts in every sample are required for median-ratio normalization.");
  requireInput(librarySizes.every(x => Number.isFinite(x) && x > 0), "Every sample must have a positive finite library size.");
  const factors = ratios.map(rs => medianSorted(rs));
  requireInput(factors.every(x => Number.isFinite(x) && x > 0), "Unable to compute valid sample normalization factors.");
  const normalizer = Math.exp(factors.reduce((s, x) => s + Math.log(x), 0) / samples);
  const sizeFactors = factors.map(x => x / normalizer);
  const typicalLibrary = medianSorted(librarySizes.map((n, i) => n / sizeFactors[i]));
  const idxReference = sampleNames.map((_, i) => i).filter(i => labels.get(sampleNames[i]) === reference);
  const idxComparison = sampleNames.map((_, i) => i).filter(i => labels.get(sampleNames[i]) === comparison);
  const genes: ExpressionGene[] = [];
  const excluded = {low_expression: 0, zero_variance: 0};
  let pcaTop: Array<{variance: number; centered: number[]}> = [];
  for (const entry of raw) {
    const cpm = entry.counts.map((n, i) => (n / sizeFactors[i]) / typicalLibrary * 1e6);
    const expressed = cpm.reduce((a, v) => a + Number(v >= settings.minCpm), 0);
    if (expressed < Math.min(idxReference.length, idxComparison.length)) { excluded.low_expression++; continue; }
    const logs = cpm.map(x => Math.log2(x + 1));
    const mean = logs.reduce((sum, x) => sum + x, 0) / samples;
    const centered = logs.map(x => x - mean);
    const variance = centered.reduce((sum, v) => sum + v * v, 0) / samples;
    if (variance > 1e-12) {
      pcaTop.push({variance, centered});
      if (pcaTop.length > 500) pcaTop = pcaTop.sort((a, b) => b.variance - a.variance).slice(0, 240);
    }
    const referenceLog = idxReference.map(i => logs[i]);
    const comparisonLog = idxComparison.map(i => logs[i]);
    const a = varianceAndMean(referenceLog), b = varianceAndMean(comparisonLog);
    const v1 = a.variance / idxReference.length;
    const v2 = b.variance / idxComparison.length;
    const se2 = v1 + v2;
    if (se2 <= 1e-15) {excluded.zero_variance++; continue;}
    const dfDen = v1 * v1 / (idxReference.length - 1) + v2 * v2 / (idxComparison.length - 1);
    if (dfDen <= 0) {excluded.zero_variance++; continue;}
    const df = se2 * se2 / dfDen;
    const t = (b.mean - a.mean) / Math.sqrt(se2);
    const p = studentTTwoSidedP(t, df);
    const meanA = idxReference.reduce((sum, i) => sum + cpm[i], 0) / idxReference.length;
    const meanB = idxComparison.reduce((sum, i) => sum + cpm[i], 0) / idxComparison.length;
    genes.push({geneId: entry.geneId, baseMean: cpm.reduce((sum, x) => sum + x, 0) / samples,
      meanReferenceCpm: meanA, meanComparisonCpm: meanB,
      log2FoldChange: Math.log2((meanB + 1) / (meanA + 1)), welchT: t,
      degreesOfFreedom: df, p, fdr: 1});
  }
  requireInput(genes.length > 0, "No genes survived expression and nonzero-variance filters; no analysis was generated.");
  const fdr = benjaminiHochberg(genes.map(g => g.p));
  for (let i = 0; i < genes.length; i++) genes[i].fdr = fdr[i];
  const features = Math.min(200, pcaTop.length);
  const pca = principalComponents(samples, pcaTop);
  const qc: ExpressionSample[] = sampleNames.map((id, i) => ({sampleId: id, group: labels.get(id)!,
    librarySize: librarySizes[i], sizeFactor: sizeFactors[i], pc1: pca.axes[0][i], pc2: pca.axes[1][i]}));
  const warnings = ["Exploratory Welch tests on log2 median-ratio normalized CPM; not DESeq2, edgeR or a negative-binomial RNA-seq model.",
    "This unadjusted two-group method does not handle batch effects, covariates, paired designs, relatedness or clinical inference."];
  const low = Math.min(...librarySizes), high = Math.max(...librarySizes);
  if (high / low >= 5) warnings.push("Library sizes vary by at least 5-fold. Review library QC and normalization assumptions.");
  const medianP = medianSorted(genes.map(g => g.p));
  if (medianP < .1) warnings.push("Unusually small median P-value: investigate confounding, normalization and model assumptions.");
  return {schema: "genithm-expression/1", version: EXPRESSION_VERSION,
    method: "Median-ratio size factors; log2 normalized CPM+1; two-sided Welch t-test; BH FDR",
    referenceGroup: reference, comparisonGroup: comparison, minCpm: settings.minCpm,
    genesSeen: raw.length, genesTested: genes.length, excluded,
    samplesMatched: samples, sampleGroups: Object.fromEntries(groupCount),
    sizeFactorMethod: "DESeq-style all-positive-gene median ratios (no dispersion model)",
    pcaFeatures: features, pcaExplainedVariance: pca.explained, genes, samples: qc, warnings};
}

export function expressionTsv(result: ExpressionResult): string {
  const header = ["gene_id", "baseMean_normalized_CPM", "mean_reference_CPM", "mean_comparison_CPM",
    "log2FC_comparison_over_reference", "welch_t", "welch_df", "pvalue", "padj_BH"].join("\t");
  return [header, ...result.genes.map(g => [safeTsv(g.geneId), g.baseMean, g.meanReferenceCpm,
    g.meanComparisonCpm, g.log2FoldChange, g.welchT, g.degreesOfFreedom, g.p, g.fdr].join("\t"))].join("\n") + "\n";
}
export function expressionGeneList(result: ExpressionResult, significant: boolean): string {
  return "gene_id\n" + result.genes.filter(g => !significant || (g.fdr < .05 && Math.abs(g.log2FoldChange) >= 1))
    .map(g => safeTsv(g.geneId)).join("\n") + "\n";
}
