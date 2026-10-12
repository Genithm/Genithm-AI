/**
 * Science V15: cross-pipeline research studies.
 * A study is a READ-ONLY projection over existing completed, owner-scoped
 * autonomous workflows. No scientific execution or new conclusions are made.
 */
import {
  assembleDossier, canonicalDossierJson, type Dossier,
  type SealedReport,
} from "./research-dossier.ts";
import {
  reconcilePipeline, type PipelineRow, type SourceRow,
  type SequenceRow, type ScienceRow,
} from "./research-pipeline.ts";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA=/^[0-9a-f]{64}$/;
export const STUDY_MIN_RUNS=2;
export const STUDY_MAX_RUNS=8;

export type PipelineInputEvidence={
  job_id:string; project_id:string; sequence_upload_id:string;
  input_position:number; input_sha256:string;
};
export type StudySourceEvidence={
  run:PipelineRow;
  source:SourceRow|null;
  sequence:SequenceRow|null;
  science:ScienceRow|null;
  inputs:PipelineInputEvidence[];
  report:SealedReport|null;
};
export type StudyProvenance={
  pipeline_id:string;
  template:string;
  accession:string;
  retrieval_id:string;
  sequence_upload_id:string;
  sequence_sha256:string;
  scientific_job_id:string;
  scientific_result_sha256:string;
  sealed_report_id:string;
  sealed_report_sha256:string;
  created_at:string;
  finished_at:string;
};
export type StudyPayload={
  schema_version:"genithm-pipeline-study/1";
  project_id:string;
  pipelines:StudyProvenance[];
  sealed_dossier: Dossier["payload"];
};
export type Study={
  payload:StudyPayload;
  dossier:Dossier;
  payload_sha256:string;
  study_count:number;
};

export class StudyValidationError extends Error{
  constructor(message:string){super(message);this.name="StudyValidationError";}
}
function ensure(condition:unknown,message:string):asserts condition{
  if(!condition)throw new StudyValidationError(message);
}
export function validateStudySelection(projectId:string,runIds:readonly string[]){
  ensure(UUID.test(projectId),"Invalid project identifier.");
  ensure(runIds.length>=STUDY_MIN_RUNS&&runIds.length<=STUDY_MAX_RUNS,
    "Choose between two and eight pipeline runs.");
  ensure(runIds.every(id=>UUID.test(id)),"Invalid pipeline identifier.");
  const normalized=runIds.map(id=>id.toLowerCase());
  ensure(new Set(normalized).size===normalized.length,"Duplicate pipeline selection.");
  return {projectId:projectId.toLowerCase(),runIds:normalized.sort()};
}
async function sha256(text:string){
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,"0")).join("");
}
export async function assemblePipelineStudy(
  projectId:string,selectedIds:readonly string[],
  evidence:readonly StudySourceEvidence[],
):Promise<Study>{
  const selection=validateStudySelection(projectId,selectedIds);
  ensure(evidence.length===selection.runIds.length,"Pipeline evidence missing or inaccessible.");
  const byId=new Map<string,StudySourceEvidence>();
  for(const row of evidence){
    ensure(UUID.test(row.run.id)&&!byId.has(row.run.id.toLowerCase()),
      "Duplicate or malformed pipeline evidence.");
    byId.set(row.run.id.toLowerCase(),row);
  }
  const records:StudyProvenance[]=[];
  const reports:SealedReport[]=[];
  const sameOwner=new Set<string>();
  const sameOrganization=new Set<string>();
  for(const runId of selection.runIds){
    const row=byId.get(runId);
    ensure(row,"Selected pipeline is missing or inaccessible.");
    const {run,source,sequence,science,inputs,report}=row;
    ensure(run.project_id.toLowerCase()===selection.projectId,
      "Pipeline is outside the selected project.");
    sameOwner.add(run.requested_by);
    sameOrganization.add(run.organization_id);
    ensure(run.status==="completed","A selected pipeline is not completed.");
    const projection=reconcilePipeline(run,source,sequence,science);
    ensure(projection.displayStatus==="complete"&&projection.integrity==="recorded_consistent",
      "Pipeline provenance needs investigation.");
    ensure(source&&sequence&&science&&report,
      "Completed source, scientific result and sealed report are required.");
    ensure(typeof run.sequence_upload_id==="string"&&typeof run.scientific_job_id==="string"&&
      typeof run.sequence_sha256==="string"&&SHA.test(run.sequence_sha256)&&
      typeof science.result_sha256==="string"&&SHA.test(science.result_sha256),
      "Pipeline has no valid scientific result lineage.");
    // Crucial V15 addition: job input evidence is checked independently of
    // the pipeline record itself. The original V14 reader only compared
    // metadata but did not read scientific_job_inputs.
    ensure(inputs.length===1&&inputs[0].job_id===science.id&&
      inputs[0].project_id===selection.projectId&&
      inputs[0].sequence_upload_id===sequence.id&&
      inputs[0].input_position===1&&
      inputs[0].input_sha256===run.sequence_sha256,
      "Scientific job input does not prove the recorded sequence dependency.");
    ensure(report.integrity_valid===true&&
      report.project_id===selection.projectId&&
      report.source_resource_type==="scientific_job"&&
      report.source_resource_id===science.id&&
      report.source_job_type==="protein_properties"&&
      report.source_result_sha256===science.result_sha256&&
      SHA.test(report.report_sha256),
      "Sealed report is missing or does not match the verified scientific result.");
    records.push({
      pipeline_id:run.id,
      template:run.template,
      accession:run.requested_accession,
      retrieval_id:run.retrieval_id,
      sequence_upload_id:sequence.id,
      sequence_sha256:run.sequence_sha256,
      scientific_job_id:science.id,
      scientific_result_sha256:science.result_sha256,
      sealed_report_id:report.id,
      sealed_report_sha256:report.report_sha256,
      created_at:run.created_at,
      finished_at:run.finished_at!,
    });
    reports.push(report);
  }
  ensure(sameOwner.size===1&&sameOrganization.size===1,
    "A study cannot combine different owners or organizations.");
  ensure(new Set(reports.map(report=>report.id)).size===reports.length,
    "Each selected pipeline must have a separate sealed report.");
  const dossier=await assembleDossier(selection.projectId,reports.map(r=>r.id),reports);
  const payload:StudyPayload={
    schema_version:"genithm-pipeline-study/1",
    project_id:selection.projectId,
    pipelines:records,
    sealed_dossier:dossier.payload,
  };
  return {
    payload,dossier,study_count:records.length,
    payload_sha256:await sha256(canonicalDossierJson(payload)),
  };
}
export function renderPipelineStudyMarkdown(study:Study,projectName:string){
  const safe=(s:string)=>s.replace(/[|\r\n]/g," ").slice(0,140);
  const reports=study.payload.sealed_dossier.reports;
  const index=new Map(reports.map((r,i)=>[r.report_id,i]));
  return [
    "# Genithm Cross-Pipeline Research Study","","- Project: "+safe(projectName),
    "- Project ID: "+study.payload.project_id,
    "- Pipeline count: "+study.study_count,
    "- Study schema: "+study.payload.schema_version,
    "- Canonical study payload SHA-256: "+study.payload_sha256,
    "- Canonicalization: recursively sorted JSON keys, UTF-8, compact JSON",
    "",
    "## End-to-end source and scientific provenance","",
    ...study.payload.pipelines.flatMap((p,i)=>[
      "### "+(i+1)+". "+safe(p.accession),"",
      "- Pipeline: "+p.pipeline_id,
      "- NCBI retrieval: "+p.retrieval_id,
      "- Validated FASTA: "+p.sequence_upload_id,
      "- FASTA SHA-256: "+p.sequence_sha256,
      "- Protein-properties job: "+p.scientific_job_id,
      "- Scientific result SHA-256: "+p.scientific_result_sha256,
      "- Sealed report: "+p.sealed_report_id,
      "- Report seal SHA-256: "+p.sealed_report_sha256,"",
    ]),
    "## Recorded numerical measurements","",
    "| Measurement | "+study.payload.pipelines.map(p=>safe(p.accession)).join(" | ")+" |",
    "| --- | "+study.payload.pipelines.map(()=>"---:").join(" | ")+" |",
    ...study.dossier.comparison.map(r=>
      "| "+safe(r.label+(r.unit?" ("+r.unit+")":""))+" | "+
      study.payload.pipelines.map(p=>{
        const col=index.get(p.sealed_report_id);
        return col===undefined||r.values[col]===null?"—":String(r.values[col]);
      }).join(" | ")+" |"),
    "",
    "The original reports were sealed and reverified under the authorized researcher's database session.",
    "The study checksum detects changes only if the trusted expected digest is retained separately.",
    "It is not a digital signature, external source freshness guarantee, artifact-byte audit,",
    "scientific validation, statistical significance claim or new AI-generated conclusion.","",
  ].join("\n");
}
