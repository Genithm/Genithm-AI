/**
 * Deterministic, bounded preflight hints derived solely from the
 * project-scoped context returned by request_ai_chat_turn. These are NOT
 * authorization decisions: the Supabase request RPCs recheck everything.
 * No client-supplied IDs or untrusted LLM plan arguments are added here.
 */
type Dict = Record<string, unknown>;

function object(value: unknown): Dict | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Dict : null;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA = /^[0-9a-f]{64}$/i;

type ReadySequence = {
  id: string;
  filename: string;
  sequence_type: "dna" | "rna" | "protein";
  residue_count: number;
  sha256: string;
};

function readySequence(value: unknown): ReadySequence | null {
  const row = object(value);
  if (!row || typeof row.id !== "string" || !ID.test(row.id) ||
      typeof row.sha256 !== "string" || !SHA.test(row.sha256)) return null;
  const sequenceType = String(row.sequence_type ?? "").toLowerCase();
  if (!["dna", "rna", "protein"].includes(sequenceType) ||
      typeof row.residue_count !== "number" ||
      !Number.isSafeInteger(row.residue_count) || row.residue_count < 1) return null;
  return {
    id: row.id,
    filename: typeof row.filename === "string" ? row.filename.slice(0, 255) : "sequence",
    sequence_type: sequenceType as ReadySequence["sequence_type"],
    residue_count: row.residue_count,
    sha256: row.sha256.toLowerCase(),
  };
}

function uniqueSequences(items: unknown[]): ReadySequence[] {
  const unique = new Map<string, ReadySequence>();
  for (const item of items.slice(0, 120)) {
    const sequence = readySequence(item);
    if (sequence && !unique.has(sequence.id)) unique.set(sequence.id, sequence);
  }
  return [...unique.values()].slice(0, 100);
}

export function buildAuthorizedResearchContext(raw: unknown) {
  const scoped = object(raw);
  if (!scoped) throw new Error("Authorized research context is unavailable.");

  const sequences = uniqueSequences(array(scoped.sequences));
  const byType = {
    nucleotide: sequences.filter((s) => s.sequence_type === "dna" || s.sequence_type === "rna"),
    dna: sequences.filter((s) => s.sequence_type === "dna"),
    rna: sequences.filter((s) => s.sequence_type === "rna"),
    protein: sequences.filter((s) => s.sequence_type === "protein"),
  };

  const currentAttachments = array(scoped.current_attachments).slice(0, 10)
    .map(object).filter((item): item is Dict => item !== null)
    .filter((item) => typeof item.id === "string" && ID.test(item.id))
    .map((item) => ({
      id: item.id as string,
      filename: typeof item.filename === "string" ? item.filename.slice(0, 255) : "file",
      status: typeof item.status === "string" ? item.status.slice(0, 30) : "unknown",
      sequence_type: typeof item.sequence_type === "string" ? item.sequence_type : null,
    }));

  const completedMsaJobs = array(scoped.scientific_jobs).slice(0, 30)
    .map(object).filter((item): item is Dict => item !== null)
    .filter((job) =>
      job.job_type === "multiple_sequence_alignment" &&
      job.status === "completed" &&
      typeof job.id === "string" && ID.test(job.id) &&
      typeof job.result_sha256 === "string" && SHA.test(job.result_sha256))
    .map((job) => ({ id: job.id as string, result_sha256: job.result_sha256 as string }));

  const candidates = (items: ReadySequence[]) => items.map((s) => ({
    id: s.id, filename: s.filename, sequence_type: s.sequence_type, residue_count: s.residue_count,
  }));

  return {
    ...scoped,
    capability_preflight: {
      basis: "project-scoped database snapshot; hints only, all dispatches independently revalidate scope, limits and eligibility",
      ready_sequences: candidates(sequences),
      current_attachments: currentAttachments,
      blastn_candidate_sequences: candidates(byType.nucleotide),
      blastp_candidate_sequences: candidates(byType.protein),
      protein_properties_candidates: candidates(byType.protein),
      protein_annotation_candidates: candidates(byType.protein.filter((s) =>
        array(scoped.ncbi_retrievals).some((rawRetrieval) => {
          const retrieval = object(rawRetrieval);
          return retrieval?.sequence_upload_id === s.id && retrieval?.source_database === "protein" &&
            retrieval?.status === "retrieved";
        }))),
      pairwise_input_groups: {
        dna: candidates(byType.dna),
        rna: candidates(byType.rna),
        protein: candidates(byType.protein),
      },
      msa_input_groups: {
        dna: candidates(byType.dna.slice(0, 50)),
        rna: candidates(byType.rna.slice(0, 50)),
        protein: candidates(byType.protein.slice(0, 50)),
      },
      completed_msa_jobs: completedMsaJobs,
      supported_tasks: {
        ncbi_sequence_retrieval: "explicit accession OR gene/protein target plus organism",
        blast: "one eligible validated nucleotide or protein sequence",
        pairwise_alignment: "two distinct eligible sequences of compatible type",
        multiple_sequence_alignment: "3-50 compatible ready sequences",
        msa_phylogeny_workflow: "3-50 compatible ready sequences; fixed MSA then phylogeny",
        phylogenetic_tree: "one completed eligible MSA job",
        protein_properties: "one eligible validated protein sequence",
        protein_annotation: "one eligible NCBI-origin protein sequence",
      },
    },
  };
}
