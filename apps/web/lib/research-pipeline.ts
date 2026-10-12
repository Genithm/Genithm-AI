/** V14: strict, read-only evidence reconciliation of autonomous source-to-science runs. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA = /^[a-f0-9]{64}$/;
export type PipelineRow = {
  id: string; project_id: string; organization_id: string; requested_by: string;
  requested_accession: string; template: string; retrieval_id: string;
  sequence_upload_id: string | null; sequence_sha256: string | null;
  scientific_job_id: string | null; status: string;
  failure_stage: string | null; failure_code: string | null;
  created_at: string; updated_at: string; finished_at: string | null;
};
export type SourceRow = {
  id: string; organization_id: string; project_id: string; requested_by: string;
  status: string; requested_accession: string; source_database: string;
  sequence_upload_id: string | null; resolved_accession: string | null;
};
export type SequenceRow = {
  id: string; organization_id: string; project_id: string; created_by: string;
  status: string; sequence_count: number | null; sequence_type: string | null;
  sha256: string | null;
};
export type ScienceRow = {
  id: string; organization_id: string; project_id: string; requested_by: string;
  status: string; job_type: string; result_sha256: string | null;
  parameters?: { operation?: string; min_aa?: number; motif?: string | null } | null;
};
export type PipelineProjection = {
  id: string; status: string; displayStatus: "waiting" | "active" | "complete" | "failed" | "review";
  canRefresh: boolean; integrity: "pending" | "recorded_consistent" | "mismatch";
  findings: string[];
  stages: Array<{ name: string; status: string; id: string | null; href: string | null }>;
};
export function reconcilePipeline(
  run: PipelineRow, source: SourceRow | null,
  sequence: SequenceRow | null, science: ScienceRow | null,
): PipelineProjection {
  const supported = run.template === "ncbi_protein_profile_v1" ||
    run.template === "ncbi_nucleotide_orf_v1";
  const nucleotide = run.template === "ncbi_nucleotide_orf_v1";
  if (!UUID.test(run.id) || !UUID.test(run.project_id) ||
    !UUID.test(run.requested_by) || !UUID.test(run.organization_id) ||
    !UUID.test(run.retrieval_id) || !supported) {
    throw new Error("Unsupported pipeline identity or template.");
  }
  const findings: string[] = [];
  const sourceOkay = !!source &&
    source.id === run.retrieval_id && source.project_id === run.project_id &&
    source.organization_id === run.organization_id &&
    source.requested_by === run.requested_by &&
    source.source_database === (nucleotide ? "nucleotide" : "protein") &&
    source.requested_accession === run.requested_accession;
  if (!sourceOkay) findings.push("Source retrieval identity unavailable or inconsistent");
  const seqOkay = !!sequence && !!source && !!run.sequence_upload_id &&
    sequence.id === run.sequence_upload_id &&
    source.sequence_upload_id === sequence.id &&
    sequence.organization_id === run.organization_id &&
    sequence.project_id === run.project_id &&
    sequence.created_by === run.requested_by;
  if (run.sequence_upload_id && !seqOkay) findings.push("Validated FASTA identity unavailable or inconsistent");
  const jobOkay = !!science && !!run.scientific_job_id &&
    science.id === run.scientific_job_id &&
    science.organization_id === run.organization_id &&
    science.project_id === run.project_id &&
    science.requested_by === run.requested_by &&
    (nucleotide
      ? science.job_type === "sequence_insights" &&
        science.parameters?.operation === "orf_scan" &&
        science.parameters?.min_aa === 30 &&
        (science.parameters?.motif === null || science.parameters?.motif === undefined)
      : science.job_type === "protein_properties");
  if (run.scientific_job_id && !jobOkay) findings.push("Scientific job identity unavailable or inconsistent");
  const sequenceTypeOkay = !!sequence && sequence.sequence_count === 1 &&
    sequence.sequence_type !== null &&
    (nucleotide ? ["dna","rna"].includes(sequence.sequence_type)
      : sequence.sequence_type === "protein");
  if (run.sequence_upload_id && seqOkay && !sequenceTypeOkay)
    findings.push("Validated sequence alphabet or record count mismatches the template");
  const hashOkay = !!sequence && !!run.sequence_sha256 &&
    SHA.test(run.sequence_sha256) && sequence.sha256 === run.sequence_sha256;
  if (run.sequence_sha256 && !hashOkay) findings.push("Recorded sequence SHA-256 mismatch");
  if (run.status === "completed" && (!sourceOkay || source?.status !== "retrieved" ||
    !seqOkay || !sequenceTypeOkay || sequence?.status !== "ready" || !hashOkay ||
    !jobOkay || science?.status !== "completed" ||
    typeof science.result_sha256 !== "string" || !SHA.test(science.result_sha256) ||
    !run.finished_at)) {
    findings.push("Pipeline completion is not supported by its recorded inputs and result");
  }
  if (run.status === "running" && (!jobOkay || !hashOkay || !seqOkay || !sequenceTypeOkay)) {
    findings.push("Running pipeline is missing a matching scientific job or input hash");
  }
  if (run.status === "awaiting_validation" &&
    (!seqOkay || !sourceOkay || source?.status !== "retrieved")) {
    findings.push("Validation stage cannot be verified against the source");
  }
  if ((run.status === "awaiting_source" || run.status === "awaiting_validation" || run.status === "running") &&
      run.finished_at) findings.push("Active pipeline has terminal timestamp");
  const validStatus = ["awaiting_source","awaiting_validation","running","completed","error"].includes(run.status);
  if (!validStatus) findings.push("Unknown pipeline lifecycle state");
  const integrity = findings.length ? "mismatch" :
    run.status === "completed" ? "recorded_consistent" : "pending";
  const displayStatus: PipelineProjection["displayStatus"] = findings.length ? "review" :
    run.status === "completed" ? "complete" :
    run.status === "error" ? "failed" :
    run.status === "running" ? "active" : "waiting";
  const safeLink = (id: string | null, prefix: string) => id && UUID.test(id) ? prefix + id : null;
  return {
    id: run.id, status: run.status, displayStatus, canRefresh: !findings.length &&
      ["awaiting_source","awaiting_validation","running"].includes(run.status),
    integrity, findings,
    stages: [
      {name: nucleotide ? "NCBI nucleotide retrieval" : "NCBI protein retrieval",status:sourceOkay ? source!.status : "unavailable",
        id:run.retrieval_id,href:null},
      {name:"FASTA validation",status:seqOkay ? sequence!.status : run.sequence_upload_id ? "unavailable" : "pending",
        id:run.sequence_upload_id,href:null},
      {name: nucleotide ? "ORF scan (min 30 aa)" : "Protein properties",status:jobOkay ? science!.status : run.scientific_job_id ? "unavailable" : "pending",
        id:run.scientific_job_id,href:safeLink(run.scientific_job_id,"/dashboard/scientific-jobs/")},
    ],
  };
}
