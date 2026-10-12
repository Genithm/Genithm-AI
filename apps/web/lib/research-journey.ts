/**
 * Science V13: read-only source-to-science-to-report journey reconciliation.
 * The database records are authoritative; this projection never asserts an
 * unrecorded NCBI->analysis relationship or creates an automatic replay.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA = /^[a-f0-9]{64}$/;
export type Retrieval = { id: string; project_id: string; status: string; source_database: string; requested_accession: string; resolved_accession: string|null; sequence_upload_id: string|null; created_at: string; source_retrieved_at: string|null };
export type Upload = { id: string; project_id: string; status: string; sequence_type: string|null; sequence_count: number|null; sha256: string|null; original_filename?: string|null };
export type Science = { id: string; project_id: string; job_type: string; status: string; result_sha256: string|null; created_at: string };
export type JobInput = { job_id: string; project_id: string; sequence_upload_id: string; input_position: number };
export type Report = { id: string; project_id: string; source_resource_type: string; source_resource_id: string; report_sha256: string; generated_at: string };
export type Journey = {
  retrieval: Retrieval;
  upload: Upload|null;
  analyses: Array<Science & { positions: number[]; reports: Report[] }>;
  retrievalReports: Report[];
  state: "retrieving"|"not_found"|"error"|"needs_validation"|"ready"|"analyzing"|"complete"|"integrity_review";
  guidance: string;
  linkedBy: "recorded_upload_id";
};
const finalStatuses = new Set(["completed","error","cancelled"]);
export function reconcileResearchJourney(
  projectId: string, retrievals: readonly Retrieval[], uploads: readonly Upload[],
  jobs: readonly Science[], inputs: readonly JobInput[], reports: readonly Report[],
): Journey[] {
  if (!UUID.test(projectId)) throw new Error("Invalid authorized project");
  const validUploads = new Map(uploads.filter(x=>x.project_id===projectId && UUID.test(x.id)).map(x=>[x.id,x]));
  const validJobs = new Map(jobs.filter(x=>x.project_id===projectId && UUID.test(x.id)).map(x=>[x.id,x]));
  const reportMap = new Map<string, Report[]>();
  for (const report of reports) {
    if (report.project_id!==projectId || !UUID.test(report.id) || !UUID.test(report.source_resource_id) ||
        !SHA.test(report.report_sha256)) continue;
    const key=report.source_resource_type+":"+report.source_resource_id;
    reportMap.set(key,[...(reportMap.get(key)??[]),report]);
  }
  const byUpload = new Map<string, Map<string,number[]>>();
  for (const item of inputs) {
    if (item.project_id!==projectId || !validUploads.has(item.sequence_upload_id) || !validJobs.has(item.job_id) ||
      !Number.isSafeInteger(item.input_position) || item.input_position<1 || item.input_position>50) continue;
    const row=byUpload.get(item.sequence_upload_id)??new Map<string,number[]>();
    row.set(item.job_id,[...(row.get(item.job_id)??[]),item.input_position]);
    byUpload.set(item.sequence_upload_id,row);
  }
  return retrievals.filter(x=>x.project_id===projectId && UUID.test(x.id)).map(retrieval=>{
    const upload = retrieval.sequence_upload_id ? validUploads.get(retrieval.sequence_upload_id)??null:null;
    const linkedJobs = [...(upload ? byUpload.get(upload.id)??new Map<string,number[]>() : [])]
      .map(([id,positions])=>({job:validJobs.get(id),positions}))
      .filter((x):x is {job:Science;positions:number[]}=>Boolean(x.job))
      .sort((a,b)=>a.job.created_at.localeCompare(b.job.created_at))
      .map(({job,positions})=>({...job,positions:positions.sort((a,b)=>a-b),
        reports:reportMap.get("scientific_job:"+job.id)??[]}));
    const retrievalReports=reportMap.get("sequence_retrieval:"+retrieval.id)??[];
    let state: Journey["state"];
    let guidance: string;
    if (retrieval.status==="not_found") {
      state="not_found";guidance="NCBI could not identify the accession. Confirm the accession before requesting new data.";
    } else if (retrieval.status==="error" || retrieval.status==="rejected") {
      state="error";guidance="Review the retrieval and its provider status. No downstream analysis was started by this view.";
    } else if (retrieval.status!=="retrieved") {
      state="retrieving";guidance="The authoritative source retrieval is still in progress.";
    } else if (!upload || upload.project_id!==projectId || (upload.sha256 && !SHA.test(upload.sha256 ?? ""))) {
      state="integrity_review";guidance="The retrieved sequence record is unavailable or its recorded integrity metadata is invalid.";
    } else if (upload.status!=="ready" || upload.sequence_count!==1 || !SHA.test(upload.sha256 ?? "")) {
      state="needs_validation";guidance="Sequence data must be validated as one supported FASTA record before analysis.";
    } else if (!linkedJobs.length) {
      state="ready";guidance="This validated NCBI-derived sequence can now be selected for a compatible scientific analysis.";
    } else if (linkedJobs.some(j=>!finalStatuses.has(j.status))) {
      state="analyzing";guidance="Linked scientific jobs are queued or running. Review each analysis before interpreting it.";
    } else {
      state="complete";guidance="Linked scientific execution finished. Only successfully completed jobs are eligible for verified reports.";
    }
    return {retrieval,upload,analyses:linkedJobs,retrievalReports,state,guidance,
      linkedBy:"recorded_upload_id" as const};
  });
}
export function eligibleSequence(upload: Upload, kind:"nucleotide"|"protein"):boolean {
  return upload.status==="ready" && upload.sequence_count===1 && typeof upload.sha256==="string" &&
    SHA.test(upload.sha256) && (kind==="protein"? upload.sequence_type==="protein" :
    upload.sequence_type==="dna" || upload.sequence_type==="rna");
}
