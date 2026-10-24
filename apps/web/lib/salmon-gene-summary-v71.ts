/** Genithm V71: bounded, browser-local gene summaries from VALIDATED Salmon
 * transcript-level matrices and a researcher-supplied transcript-to-gene map.
 *
 * This deliberately does NOT implement or claim equivalence to Bioconductor
 * tximport/tximeta. It uses simple sums of TPM and fractional estimated counts;
 * no gene-level effective-length offsets, lengthScaledTPM, inferential
 * replicates, DESeq2 tests or real raw FASTQ quantification are calculated.
 *
 * No network calls, secrets, genome or medical annotations are involved.
 */
import type {SalmonMatrix} from "./salmon-quant-matrix";

export const GENITHM_GENE_SUMMARY_SCHEMA = "genithm-salmon-gene-summary/1";
export const MAX_TX2GENE_BYTES = 8 * 1024 * 1024;
export const MAX_TX2GENE_ROWS = 150000;
export const MAX_GENE_MATRIX_CELLS = 1000000;
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:|\-]{0,253}$/;
const NUMBER = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/;

export class SalmonGeneSummaryError extends Error {
  readonly code: string;
  constructor(code: string, detail: string) {
    super(detail);
    this.name = "SalmonGeneSummaryError";
    this.code = code;
  }
}
function fail(code: string, message: string): never {
  throw new SalmonGeneSummaryError(code, message);
}

export type SalmonGeneSummary = {
  schema: typeof GENITHM_GENE_SUMMARY_SCHEMA;
  status: "summarized_external_salmon_outputs_only";
  samples: number;
  genes: number;
  transcripts: number;
  mapped_transcripts: number;
  mapping_rows: number;
  mapping_rows_not_quantified: number;
  multi_transcript_genes: number;
  sample_summaries: Array<{
    sample: string;
    reported_transcript_tpm: number;
    summarized_gene_tpm: number;
    reported_estimated_fragments: number;
    summarized_gene_estimated_fragments: number;
  }>;
  gene_tpm_tsv: string;
  gene_estimated_fragments_tsv: string;
  gene_transcript_counts_tsv: string;
  warnings: string[];
  source_reads_verified: false;
  transcriptome_reference_verified: false;
  tximport_equivalent: false;
  gene_level_differential_expression_performed: false;
};

function safeText(input: string, label: string, maximum: number): string {
  if (typeof input !== "string" || !input.trim()) fail("empty", label + " must not be empty.");
  if (new TextEncoder().encode(input).byteLength > maximum)
    fail("size", label + " exceeds its bounded input limit.");
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(input))
    fail("control", label + " contains an unsafe control character.");
  return input.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
}

function linesFrom(input: string, label: string, maxBytes: number): string[] {
  const lines = safeText(input, label, maxBytes).split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  if (lines.some(x => !x || x.includes("\r"))) fail("rows", label + " contains a blank or malformed line.");
  return lines;
}

/** Strict exact-ID matching: no automatic version stripping, truncation or joins. */
export function parseTx2GeneMapping(source: string): Map<string, string> {
  const lines = linesFrom(source, "Transcript-to-gene mapping", MAX_TX2GENE_BYTES);
  if (lines[0] !== "transcript_id\tgene_id")
    fail("header", "Mapping requires an exact 'transcript_id<TAB>gene_id' header.");
  if (lines.length < 2) fail("empty", "Transcript-to-gene mapping has no data rows.");
  if (lines.length - 1 > MAX_TX2GENE_ROWS)
    fail("rows", "Transcript-to-gene mapping exceeds the 150,000-row limit.");
  const mapping = new Map<string, string>();
  for (let i = 1; i < lines.length; i++) {
    const fields = lines[i].split("\t");
    if (fields.length !== 2) fail("columns", "Mapping row " + (i + 1) + " needs exactly two columns.");
    const [transcript, gene] = fields;
    if (!ID.test(transcript) || !ID.test(gene))
      fail("identifier", "Mapping row " + (i + 1) + " contains an invalid transcript or gene identifier.");
    if (mapping.has(transcript))
      fail("duplicate", "Mapping has duplicate or ambiguous transcript identifiers.");
    mapping.set(transcript, gene);
  }
  return mapping;
}

type NumericTable = {
  samples: string[];
  rows: Array<{transcript: string; values: number[]}>;
};
function numericMatrix(tsv: string, expectedSamples: number, label: string): NumericTable {
  // Existing V70 matrices are bounded to 1,000,000 cells and at most 24 samples.
  const lines = linesFrom(tsv, label, 112 * 1024 * 1024);
  const head = lines[0].split("\t");
  if (head[0] !== "transcript_id" || head.length !== expectedSamples + 1)
    fail("matrix", label + " is not a validated transcript-level matrix.");
  const samples = head.slice(1);
  if (samples.some(s => !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(s)) ||
      new Set(samples).size !== samples.length)
    fail("matrix", label + " has invalid or duplicated samples.");
  if ((lines.length - 1) * expectedSamples > MAX_GENE_MATRIX_CELLS)
    fail("cells", "Gene-level summary exceeds the one-million-cell limit.");
  const rows: NumericTable["rows"] = [];
  const seen = new Set<string>();
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split("\t");
    if (parts.length !== expectedSamples + 1 || !ID.test(parts[0]) || seen.has(parts[0]))
      fail("matrix", label + " contains an invalid, duplicate or incomplete transcript row.");
    seen.add(parts[0]);
    const values = parts.slice(1).map(n => {
      if (!NUMBER.test(n)) fail("number", label + " contains a nonnumeric value.");
      const parsed = Number(n);
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1e14)
        fail("range", label + " contains a nonfinite or out-of-range value.");
      return parsed;
    });
    rows.push({transcript: parts[0], values});
  }
  return {samples, rows};
}
function near(actual: number, target: number, transcripts: number): boolean {
  // The V70 sample summary rounds to 6 decimal places; minor IEEE-754
  // accumulation differences are possible for thousands of values.
  return Math.abs(actual - target) <= Math.max(0.00001, 0.000001 * transcripts);
}
function roundForEvidence(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 1e14)
    fail("overflow", "Aggregate exceeded a finite, safe scientific range.");
  return Number(value.toFixed(6));
}

/** Compute actual gene-level sums, with exact transcript-level conservation. */
export function summarizeSalmonGenes(matrix: SalmonMatrix, tx2geneText: string): SalmonGeneSummary {
  if (!matrix || matrix.schema !== "genithm-salmon-transcript-matrix/1" ||
      matrix.status !== "imported_quantification_outputs_only" ||
      matrix.quantification_performed_by_genithm !== false ||
      matrix.differential_expression_performed !== false ||
      matrix.raw_reads_inspected !== false ||
      matrix.reference_provenance_verified !== false ||
      !Number.isSafeInteger(matrix.samples) || matrix.samples < 1 || matrix.samples > 24 ||
      !Number.isSafeInteger(matrix.transcripts) || matrix.transcripts < 1 ||
      matrix.samples * matrix.transcripts > MAX_GENE_MATRIX_CELLS ||
      !Array.isArray(matrix.sample_stats) || matrix.sample_stats.length !== matrix.samples)
    fail("source", "Requires a completed, bounded V70 Salmon transcript import, not a supplied gene count matrix.");

  const mapping = parseTx2GeneMapping(tx2geneText);
  const tpm = numericMatrix(matrix.transcript_tpm_tsv, matrix.samples, "Salmon TPM matrix");
  const fragment = numericMatrix(matrix.transcript_estimated_fragments_tsv, matrix.samples, "Salmon fragments matrix");
  if (tpm.rows.length !== matrix.transcripts || fragment.rows.length !== matrix.transcripts ||
      tpm.samples.join("\0") !== fragment.samples.join("\0") ||
      tpm.samples.some((s, i) => s !== matrix.sample_stats[i]?.sample))
    fail("matrix", "Salmon abundance and estimated-fragment matrix sample labels or dimensions do not match.");

  const genes = new Map<string, {tpms: number[]; fragments: number[]; transcripts: number}>();
  const measuredTpm = Array(matrix.samples).fill(0) as number[];
  const measuredCount = Array(matrix.samples).fill(0) as number[];
  let mapped = 0;
  for (let i = 0; i < tpm.rows.length; i++) {
    const abundance = tpm.rows[i], count = fragment.rows[i];
    if (abundance.transcript !== count.transcript)
      fail("matrix", "Transcript order differs between TPM and count matrices.");
    const gene = mapping.get(abundance.transcript);
    if (!gene) fail("unmapped", "At least one quantified transcript lacks an exact gene mapping.");
    mapped++;
    let values = genes.get(gene);
    if (!values) {
      values = {tpms: Array(matrix.samples).fill(0), fragments: Array(matrix.samples).fill(0), transcripts: 0};
      genes.set(gene, values);
    }
    values.transcripts++;
    for (let j = 0; j < matrix.samples; j++) {
      values.tpms[j] += abundance.values[j];
      values.fragments[j] += count.values[j];
      measuredTpm[j] += abundance.values[j];
      measuredCount[j] += count.values[j];
    }
  }
  if (mapped !== matrix.transcripts)
    fail("unmapped", "Not all measured transcripts have a gene mapping.");
  if (genes.size * matrix.samples > MAX_GENE_MATRIX_CELLS)
    fail("cells", "Gene summary exceeds the one-million-cell matrix limit.");
  const outputs = [...genes.entries()].sort((a, b) => a[0].localeCompare(b[0], "en"));
  const header = "gene_id\t" + tpm.samples.join("\t") + "\n";
  const geneTpm = [header], geneCount = [header];
  const geneTx = ["gene_id\tmapped_transcripts\n"];
  const summedTpm = Array(matrix.samples).fill(0) as number[];
  const summedCount = Array(matrix.samples).fill(0) as number[];
  for (const [gene, values] of outputs) {
    const t = values.tpms.map(roundForEvidence);
    const n = values.fragments.map(roundForEvidence);
    geneTpm.push(gene + "\t" + t.join("\t") + "\n");
    geneCount.push(gene + "\t" + n.join("\t") + "\n");
    geneTx.push(gene + "\t" + values.transcripts + "\n");
    for (let j = 0; j < matrix.samples; j++) {
      summedTpm[j] += values.tpms[j];
      summedCount[j] += values.fragments[j];
    }
  }
  const summaries = matrix.sample_stats.map((sample, j) => {
    if (sample.sample !== tpm.samples[j] ||
        !near(measuredTpm[j], sample.total_reported_tpm, matrix.transcripts) ||
        !near(measuredCount[j], sample.total_estimated_fragments, matrix.transcripts) ||
        !near(summedTpm[j], measuredTpm[j], matrix.transcripts) ||
        !near(summedCount[j], measuredCount[j], matrix.transcripts))
      fail("conservation", "Gene-level sums must conserve independently validated transcript totals.");
    return {
      sample: sample.sample,
      reported_transcript_tpm: sample.total_reported_tpm,
      summarized_gene_tpm: roundForEvidence(summedTpm[j]),
      reported_estimated_fragments: sample.total_estimated_fragments,
      summarized_gene_estimated_fragments: roundForEvidence(summedCount[j])
    };
  });
  const extra = mapping.size - mapped;
  const warnings = [
    "Real sums of already existing Salmon transcript-level abundance estimates. Genithm did not align or quantify source FASTQ reads.",
    "A transcript-to-gene map was supplied by the researcher; no assembly, transcriptome release or reference/index compatibility was independently verified.",
    "Gene estimated fragments may be fractional and lack length/abundance offsets. This is NOT tximport/tximeta, tximport countsFromAbundance, raw gene integer counts, or a DESeq2/edgeR-ready object.",
    "TPM reflects abundance relative to the transcriptome and is not a gene-level statistical differential-expression test.",
    "One-to-one transcript-to-gene assignment is required; transcript versions are matched exactly without automatic truncation."
  ];
  if (extra) warnings.push(extra + " mapping entries were not in the quantified transcript files and were not included.");
  return {
    schema: GENITHM_GENE_SUMMARY_SCHEMA,
    status: "summarized_external_salmon_outputs_only",
    samples: matrix.samples, genes: genes.size, transcripts: matrix.transcripts,
    mapped_transcripts: mapped, mapping_rows: mapping.size,
    mapping_rows_not_quantified: extra,
    multi_transcript_genes: outputs.filter(([,v]) => v.transcripts > 1).length,
    sample_summaries: summaries,
    gene_tpm_tsv: geneTpm.join(""),
    gene_estimated_fragments_tsv: geneCount.join(""),
    gene_transcript_counts_tsv: geneTx.join(""),
    warnings,
    source_reads_verified: false,
    transcriptome_reference_verified: false,
    tximport_equivalent: false,
    gene_level_differential_expression_performed: false
  };
}
