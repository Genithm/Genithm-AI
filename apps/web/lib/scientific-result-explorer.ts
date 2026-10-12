/**
 * Science V9: bounded research-facing projections of verified private artifacts.
 * This code never fetches source data or grants permissions. The server route
 * must authenticate and SHA-256 verify the full original object first.
 */
export type ExplorerResult =
  | { kind: "pairwise"; offset: number; total: number; a: string; b: string; markers: string; match: number; mismatch: number; gaps: number }
  | { kind: "msa"; offset: number; rowOffset: number; total: number; sequenceCount: number; rows: Array<{ id: string; bases: string }>; samples: Array<{ position: number; conservation: number; gapFraction: number }>; sampled: boolean }
  | { kind: "tree"; nodes: Array<{ id: number; parent: number | null; label: string | null; length: number; support: number | null }>; leaves: number; model: string }
  | { kind: "insights"; operation: string; sequenceLength: number; sequenceType: string; totalHits: number | null; truncated: boolean; records: Array<{ label: string; detail: string; sequence: string | null }>; sampleSequence: string | null }
  | { kind: "protein"; length: number; composition: Array<{ residue: string; count: number }>; properties: Array<{ label: string; value: number }> };

export class ExplorerArtifactError extends Error {
  constructor(message: string) { super(message); this.name = "ExplorerArtifactError"; }
}
function check(value: unknown, message: string): asserts value {
  if (!value) throw new ExplorerArtifactError(message);
}
function record(value: unknown): Record<string, unknown> {
  check(typeof value === "object" && value !== null && !Array.isArray(value), "Expected a result object.");
  return value as Record<string, unknown>;
}
function integer(value: unknown, min = 0, max = 10000000): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
}
function boundedOffset(value: number, total: number): number {
  check(Number.isSafeInteger(value) && value >= 0 && value <= 10000000, "Invalid result window offset.");
  return Math.min(value, Math.max(0, total - 1));
}
function jsonResult(bytes: ArrayBuffer): Record<string, unknown> {
  let obj: unknown;
  try { obj = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new ExplorerArtifactError("Scientific JSON cannot be parsed."); }
  return record(obj);
}

const WINDOW = 96;
const ROWS = 12;
const DNA = /^[ACGTUN-]+$/;
const PROTEIN = /^[ACDEFGHIKLMNPQRSTVWYBXZJUO*.-]+$/;

function fasta(text: string, declaredCount: unknown, declaredLength: unknown) {
  check(integer(declaredCount, 3, 50) && integer(declaredLength, 1, 500000),
    "MSA summary dimensions are invalid.");
  const lines = text.trimEnd().split(/\r?\n/);
  check(lines.length === declaredCount * 2, "MSA must contain canonical one-line FASTA records.");
  const all: Array<{ id: string; bases: string }> = [];
  for (let n = 0; n < declaredCount; n++) {
    const expectedId = "seq" + (n + 1);
    const bases = lines[n * 2 + 1];
    check(lines[n * 2] === ">" + expectedId, "MSA identifiers are noncanonical.");
    check(bases.length === declaredLength && PROTEIN.test(bases) && /[^-.]/.test(bases),
      "MSA residue content or alignment width is invalid.");
    all.push({ id: expectedId, bases });
  }
  return all;
}

function parseTree(text: string, expectedCount: unknown, model: unknown): Extract<ExplorerResult, { kind: "tree" }> {
  check(integer(expectedCount, 3, 50), "Phylogeny leaf count is invalid.");
  check(model === "gtr_cat" || model === "jtt_cat", "Unknown phylogenetic model.");
  check(text.length <= 4 * 1024 * 1024, "Newick result exceeds viewer size bound.");
  const source = text.trim();
  const nodes: Array<{ id: number; parent: number | null; label: string | null; length: number; support: number | null }> = [];
  const seen = new Set<string>();
  let pos = 0;
  const peek = () => source[pos] ?? "";
  const token = () => {
    const start = pos;
    while (pos < source.length && !/[\s(),:;]/.test(source[pos])) pos++;
    check(start !== pos, "Malformed Newick token.");
    return source.slice(start, pos);
  };
  const numeric = () => {
    const raw = token();
    check(/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw), "Malformed Newick numeric value.");
    const value = Number(raw);
    check(Number.isFinite(value), "Nonfinite Newick numeric value.");
    return value;
  };
  const parseNode = (parent: number | null, depth: number): void => {
    check(depth < 64 && nodes.length < 101, "Newick tree exceeds complexity bounds.");
    const id = nodes.length;
    const node: (typeof nodes)[number] = { id, parent, label: null, length: 0, support: null };
    nodes.push(node);
    if (peek() === "(") {
      pos++;
      let children = 0;
      while (true) {
        parseNode(id, depth + 1);
        children++;
        if (peek() === ",") { pos++; continue; }
        check(peek() === ")" && children >= 2, "Malformed Newick internal node.");
        pos++;
        break;
      }
      if (peek() && !":,);".includes(peek())) {
        node.support = numeric();
        check(node.support >= 0 && node.support <= 1, "Invalid FastTree local support.");
      }
    } else {
      const label = token();
      check(/^seq[1-9]\d*$/.test(label), "Unexpected Newick leaf identifier.");
      const index = Number(label.slice(3));
      check(index <= expectedCount && !seen.has(label), "Duplicated or out-of-range Newick leaf.");
      seen.add(label);
      node.label = label;
    }
    if (peek() === ":") {
      pos++;
      node.length = numeric();
      check(node.length >= 0, "Negative branch length.");
    }
  };
  parseNode(null, 0);
  check(peek() === ";" && pos === source.length - 1, "Newick must end with a single semicolon.");
  check(seen.size === expectedCount, "Missing Newick leaves.");
  for (let i = 1; i <= expectedCount; i++) check(seen.has("seq" + i), "Newick leaves do not match inputs.");
  return { kind: "tree", nodes, leaves: expectedCount, model };
}

function formatEvidenceRow(value: unknown, operation: string): { label: string; detail: string; sequence: string | null } {
  const row = record(value);
  if (operation === "six_frame_translation") {
    check((row.strand === "+" || row.strand === "-") && integer(row.frame, 1, 3) &&
          typeof row.protein === "string", "Malformed translation frame.");
    return { label: row.strand + " frame " + row.frame, detail: row.protein.length + " amino-acid positions",
      sequence: row.protein.slice(0, 96) };
  }
  check(integer(row.start_1based, 1) && integer(row.end_1based, row.start_1based) &&
        (row.strand === "+" || row.strand === "-"), "Malformed biological coordinates.");
  const label = "Positions " + row.start_1based + "–" + row.end_1based;
  if (operation === "orf_scan") {
    check(integer(row.amino_acids, 1) && typeof row.protein === "string", "Malformed ORF protein.");
    return { label, detail: row.strand + " strand · " + row.amino_acids + " aa",
      sequence: row.protein.slice(0, 96) };
  }
  return { label, detail: row.strand + " strand", sequence: null };
}

/** Build an explicitly bounded view; never return the entire raw artifact. */
export function projectScientificArtifact(
  jobType: string, bytes: ArrayBuffer, summaryValue: unknown, offset = 0, rowOffset = 0,
): ExplorerResult {
  check(bytes.byteLength > 0 && bytes.byteLength <= 25 * 1024 * 1024,
    "Scientific artifact exceeds bounded viewer limits.");
  const summary = record(summaryValue);
  check(summary.job_type === jobType, "Scientific artifact type and job metadata disagree.");
  if (jobType === "multiple_sequence_alignment") {
    const text = new TextDecoder("ascii", { fatal: true }).decode(bytes);
    const all = fasta(text, summary.sequence_count, summary.aligned_length);
    const total = all[0].bases.length;
    const start = boundedOffset(offset, total);
    check(Number.isSafeInteger(rowOffset) && rowOffset >= 0 && rowOffset < 50,
      "Invalid MSA record offset.");
    const rows = all.slice(rowOffset, rowOffset + ROWS).map(r => ({
      id: r.id, bases: r.bases.slice(start, start + WINDOW),
    }));
    const points = Math.min(128, total);
    const samples = Array.from({ length: points }, (_, i) => {
      const index = points === 1 ? 0 : Math.floor(i * (total - 1) / (points - 1));
      const counts = new Map<string, number>();
      let gaps = 0;
      for (const seq of all) {
        const residue = seq.bases[index];
        if (residue === "-" || residue === ".") { gaps++; continue; }
        counts.set(residue, (counts.get(residue) ?? 0) + 1);
      }
      const present = all.length - gaps;
      return { position: index + 1,
        conservation: present ? Math.max(...counts.values()) / present : 0,
        gapFraction: gaps / all.length };
    });
    return { kind: "msa", offset: start, rowOffset, total, sequenceCount: all.length,
      rows, samples, sampled: total > points };
  }
  if (jobType === "phylogenetic_tree") {
    return parseTree(new TextDecoder("ascii", { fatal: true }).decode(bytes), summary.leaf_count, summary.model);
  }
  const artifact = jsonResult(bytes);
  const artifactSummary = record(artifact.summary);
  check(artifactSummary.job_type === jobType, "Result JSON does not match queued job type.");
  if (jobType === "pairwise_alignment") {
    const aligned = record(artifact.alignment);
    const a = aligned.sequence_a, b = aligned.sequence_b;
    check(typeof a === "string" && typeof b === "string" && a.length === b.length &&
          a.length <= 20000 && a.length > 0 && PROTEIN.test(a) && PROTEIN.test(b),
          "Pairwise aligned sequence content is invalid.");
    check(summary.aligned_length === a.length && artifactSummary.aligned_length === a.length,
      "Pairwise length differs from recorded summary.");
    const start = boundedOffset(offset, a.length);
    const left = a.slice(start, start + WINDOW);
    const right = b.slice(start, start + WINDOW);
    const markers = [...left].map((base, i) => base === "-" || right[i] === "-" ? " " : base === right[i] ? "|" : ".").join("");
    return { kind: "pairwise", offset: start, total: a.length, a: left, b: right,
      markers, match: Number(summary.matches ?? 0), mismatch: Number(summary.mismatches ?? 0), gaps: Number(summary.gaps ?? 0) };
  }
  if (jobType === "sequence_insights") {
    const result = record(artifact.result);
    const operation = summary.operation;
    check(typeof operation === "string" && result.operation === operation &&
      integer(summary.sequence_length, 1, 200000) && (summary.sequence_type === "dna" || summary.sequence_type === "rna"),
      "Sequence insights metadata is malformed.");
    let records: Array<{ label: string; detail: string; sequence: string | null }> = [];
    let sampleSequence: string | null = null;
    let totalHits: number | null = null;
    if (operation === "orf_scan" || operation === "motif_scan" || operation === "six_frame_translation") {
      const raw = result[operation === "orf_scan" ? "orfs" : operation === "motif_scan" ? "hits" : "frames"];
      check(Array.isArray(raw), "Sequence result evidence list is malformed.");
      records = raw.slice(0, 48).map(item => formatEvidenceRow(item, operation));
      totalHits = operation === "orf_scan" ? Number(summary.orf_count) :
        operation === "motif_scan" ? Number(summary.motif_hits) : 6;
      check(Number.isSafeInteger(totalHits) && totalHits >= records.length, "Sequence result counts disagree.");
    } else if (operation === "reverse_complement") {
      check(typeof result.reverse_complement === "string" &&
        result.reverse_complement.length === summary.sequence_length &&
        DNA.test(result.reverse_complement), "Reverse complement result is malformed.");
      sampleSequence = result.reverse_complement.slice(0, 160);
    } else throw new ExplorerArtifactError("Unknown sequence analysis.");
    return { kind: "insights", operation, sequenceLength: summary.sequence_length,
      sequenceType: summary.sequence_type, totalHits, records, sampleSequence,
      truncated: result.truncated === true || records.length >= 48 };
  }
  if (jobType === "protein_properties") {
    check(integer(summary.length, 1, 200000), "Protein length is invalid.");
    const comp = record(summary.amino_acid_composition);
    const composition = Object.entries(comp).map(([residue, count]) => {
      check(/^[ACDEFGHIKLMNPQRSTVWY]$/.test(residue) && integer(count, 0, 200000),
        "Invalid amino-acid composition.");
      return { residue, count };
    }).sort((a, b) => a.residue.localeCompare(b.residue));
    check(composition.reduce((n, x) => n + x.count, 0) === summary.length,
      "Protein composition does not match length.");
    const properties = [
      ["Molecular weight (Da)", "molecular_weight_da"],
      ["Aromaticity", "aromaticity_fraction"],
      ["GRAVY", "gravy"],
      ["Estimated charge (pH 7)", "estimated_net_charge_ph7"],
      ["Estimated pI", "estimated_isoelectric_point"],
    ].map(([label, key]) => {
      const value = summary[key];
      check(typeof value === "number" && Number.isFinite(value),
        "Invalid protein physicochemical value.");
      return { label, value };
    });
    return { kind: "protein", length: summary.length, composition, properties };
  }
  throw new ExplorerArtifactError("Scientific analysis type is not supported by the explorer.");
}
