import { NextResponse } from "next/server";
import { loadResearchPipeline } from "@/lib/research-pipeline.server";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","Vary":"Cookie"};
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){
  const {id}=await params;
  const outcome=await loadResearchPipeline(id);
  if(!outcome.ok) return NextResponse.json({
    error:outcome.status===401?"Authentication required":
      outcome.status===404?"Pipeline not found":"Authorized evidence unavailable",
  },{status:outcome.status,headers});
  const {run,projection,report,source,sequence,science}=outcome.value;
  return NextResponse.json({
    schema_version:"genithm-autonomous-research-pipeline/1",
    pipeline_id:run.id,
    project_id:run.project_id,
    template:run.template,
    requested_accession:run.requested_accession,
    lifecycle:{status:run.status,failure_stage:run.failure_stage,
      failure_code:run.failure_code,created_at:run.created_at,
      updated_at:run.updated_at,finished_at:run.finished_at},
    stages:projection.stages,
    recorded_integrity:projection.integrity,
    integrity_findings:projection.findings,
    source_status:source?.status??null,
    input_status:sequence?.status??null,
    input_sha256:run.sequence_sha256,
    scientific_status:science?.status??null,
    scientific_result_sha256:science?.result_sha256??null,
    sealed_report:report,
    disclaimer:"Metadata consistency only. Not a signature, independent byte check, or biological validation.",
  },{headers:{
    ...headers,
    "Content-Security-Policy":"default-src 'none'; sandbox",
    "Content-Disposition":'attachment; filename="genithm-pipeline-'+run.id+'.json"',
  }});
}
