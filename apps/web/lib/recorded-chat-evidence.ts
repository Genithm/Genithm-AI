/**
 * Present a bounded, explicit allowlist of recorded database results in chat.
 * Never summarize arbitrary JSON keys: raw evidence can include sensitive
 * sequences, internal metadata or unreviewed provider text.
 */
type Row = Record<string, unknown>;

function record(value: unknown): Row {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Row : {};
}

export type EvidenceMetric = { label: string; value: string };

const SCIENTIFIC_KEYS = [
  "operation", "sequence_type", "sequence_length", "orf_count",
  "reported_orfs", "frame_count", "motif_hits", "reported_hits",
  "output_length", "length", "molecular_weight_da", "gravy",
  "aromaticity_fraction", "estimated_isoelectric_point",
  "estimated_net_charge_ph7", "score", "identity_percent",
  "aligned_length", "alignment_length", "matches", "mismatches",
  "gaps", "sequence_count", "strategy", "model", "leaf_count",
  "internal_support_count",
] as const;

const BLAST_KEYS = [
  "hit_count", "hits_count", "total_hits", "reported_hits",
  "query_length", "query_length_bases", "alignments",
  "best_evalue", "best_bitscore", "best_identity_percent",
  "program", "database_name",
] as const;

const LABELS: Record<string, string> = {
  molecular_weight_da: "Molecular weight (Da)",
  estimated_isoelectric_point: "Estimated pI",
  estimated_net_charge_ph7: "Estimated charge at pH 7",
  blastp: "Protein BLAST",
  blastn: "Nucleotide BLAST",
  refseq_accession: "RefSeq accession",
  resolved_accession: "NCBI accession",
  uniprot_accession: "UniProt accession",
  source_database: "NCBI database",
  protein_name: "Protein",
  sequence_upload_id: "Validated sequence reference",
};

function label(key: string): string {
  return LABELS[key] ?? key.replaceAll("_", " ");
}

function clean(value: unknown): string | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : null;
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string" && value.length <= 120 &&
      !/[<>\r\n]/.test(value)) {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  return null;
}

export function recordedEvidenceMetrics(
  kind: "scientific_job" | "blast_job" | "sequence_retrieval" | "protein_annotation_job",
  input: unknown,
): EvidenceMetric[] {
  const row = record(input);
  const status = row.status;
  if (kind === "sequence_retrieval" ? status !== "retrieved" :
      kind === "protein_annotation_job" ? status !== "completed" && status !== "no_mapping" :
      status !== "completed") return [];

  const fields: Row = kind === "scientific_job" || kind === "blast_job"
    ? record(row.result_summary)
    : row;
  const keys: readonly string[] =
    kind === "scientific_job" ? SCIENTIFIC_KEYS :
    kind === "blast_job" ? BLAST_KEYS :
    kind === "sequence_retrieval" ? ["resolved_accession", "source_database", "sequence_upload_id"] :
    ["refseq_accession", "uniprot_accession", "protein_name", "uniprot_reviewed"];

  const findings: EvidenceMetric[] = [];
  for (const key of keys) {
    const value = clean(fields[key]);
    if (value !== null) findings.push({ label: label(key), value });
    if (findings.length >= 12) break;
  }
  return findings;
}
