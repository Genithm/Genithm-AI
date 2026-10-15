/**
 * Science V20 - narrow protocol intent recognition, NOT AI authorization.
 * The explicit submit action is the researcher's consent; the existing
 * database RPCs enforce organization, project, rate and compute policy.
 */
export type ChatResearchProtocol = {
  template: "ncbi_protein_profile_v1" | "ncbi_nucleotide_orf_v1";
  accession: string;
  title: string;
  steps: readonly string[];
};

const NUCLEOTIDE = /(?:^|[^A-Z0-9_])((?:NM|NR|XM|XR|NC|NG|NT|NW)_[0-9]{4,12}(?:\.[0-9]{1,4})?)(?=$|[^A-Z0-9_])/gi;
const PROTEIN = /(?:^|[^A-Z0-9_])((?:NP|XP|YP|WP)_[0-9]{4,12}(?:\.[0-9]{1,4})?)(?=$|[^A-Z0-9_])/gi;

export function parseChatResearchProtocol(message: string): ChatResearchProtocol | null {
  if (!message || message.length > 8000) return null;
  const input = message.trim();
  const nucleotide = [...input.matchAll(NUCLEOTIDE)].map((x) => x[1].toUpperCase());
  const protein = [...input.matchAll(PROTEIN)].map((x) => x[1].toUpperCase());
  // Never guess between multiple accessions or mixed reference types.
  if (nucleotide.length + protein.length !== 1) return null;
  const requestsAction = /\b(run|analy[sz]e|scan|find|detect|calculate|compute|profile|perform|retrieve|fetch)\b/i.test(input);
  if (!requestsAction || /\b(don't|do not|never|without|avoid)\s+(?:run|analy[sz]e|scan|perform|calculate|compute|profile|fetch|retrieve)\b/i.test(input)) return null;

  if (nucleotide.length === 1 &&
      /\b(orf|orfs|open reading frames?)\b/i.test(input) &&
      !/\b(protein properties|protein profiling)\b/i.test(input)) {
    return {
      template: "ncbi_nucleotide_orf_v1",
      accession: nucleotide[0],
      title: "NCBI nucleotide to ORF research",
      steps: ["Retrieve NCBI nucleotide", "Validate FASTA", "Run fixed ORF scan (minimum 30 amino acids)"],
    };
  }
  if (protein.length === 1 &&
      /\b(protein (?:properties|profile|profiling)|molecular weight|isoelectric point|protein characterization)\b/i.test(input) &&
      !/\b(orf|open reading frame)\b/i.test(input)) {
    return {
      template: "ncbi_protein_profile_v1",
      accession: protein[0],
      title: "NCBI protein profiling research",
      steps: ["Retrieve NCBI protein", "Validate FASTA", "Compute protein properties"],
    };
  }
  return null;
}

export type ProtocolPipelineState = "awaiting_source" | "awaiting_validation" | "running" | "completed" | "error";
export type ProtocolStep = {
  name: string;
  status: "completed" | "running" | "waiting" | "failed" | "unknown";
};

export function pipelineProgress(
  template: ChatResearchProtocol["template"],
  status: string,
  retrievalStatus: string | null,
  sequenceStatus: string | null,
  scientificStatus: string | null,
): ProtocolStep[] {
  const isOrf = template === "ncbi_nucleotide_orf_v1";
  const source: ProtocolStep["status"] =
    retrievalStatus === "retrieved" ? "completed" :
    ["error", "rejected", "not_found"].includes(retrievalStatus ?? "") ? "failed" :
    ["queued", "retrieving"].includes(retrievalStatus ?? "") ? "running" :
    "waiting";
  const validation: ProtocolStep["status"] =
    sequenceStatus === "ready" ? "completed" :
    ["rejected", "error"].includes(sequenceStatus ?? "") ? "failed" :
    sequenceStatus && ["pending_validation", "validating"].includes(sequenceStatus) ? "running" : "waiting";
  const science: ProtocolStep["status"] =
    scientificStatus === "completed" ? "completed" :
    ["error", "cancelled", "failed"].includes(scientificStatus ?? "") ? "failed" :
    scientificStatus && ["queued", "running", "validating_result"].includes(scientificStatus) ? "running" : "waiting";
  const steps: ProtocolStep[] = [
    { name: isOrf ? "NCBI nucleotide retrieval" : "NCBI protein retrieval", status: source },
    { name: "FASTA sequence validation", status: validation },
    { name: isOrf ? "ORF scan" : "Protein properties", status: science },
  ];
  // The parent run reports terminal failure independently of the child status.
  // When metadata is unavailable, mark the earliest unknown stage as failed
  // rather than inventing successful jobs.
  if (status === "error" && !steps.some((x) => x.status === "failed")) {
    const pending = steps.find((x) => x.status !== "completed");
    if (pending) pending.status = "unknown";
  }
  return steps;
}
