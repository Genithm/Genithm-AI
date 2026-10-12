import "server-only";

import { createClient } from "@/lib/supabase/server";
import { DossierValidationError, type SealedReport } from "@/lib/research-dossier";
import {
  assemblePipelineStudy, StudyValidationError, validateStudySelection,
  type Study, type StudySourceEvidence,
} from "@/lib/pipeline-study";
import type { PipelineRow, SourceRow, SequenceRow, ScienceRow } from "@/lib/research-pipeline";

export type StudyLoadResult=
  |{ok:true;study:Study;projectName:string}
  |{ok:false;status:400|401|404|409|413|503;message:string};

/** No service role, no mutable operations, no raw storage object paths. */
export async function loadPipelineStudy(
  projectId:string,ids:readonly string[],
):Promise<StudyLoadResult>{
  let choice:ReturnType<typeof validateStudySelection>;
  try{choice=validateStudySelection(projectId,ids);}
  catch{return {ok:false,status:400,message:"Select 2–8 distinct completed pipeline runs from one project."};}

  const supabase=await createClient();
  const {data:claims,error:authError}=await supabase.auth.getClaims();
  if(authError||!claims?.claims?.sub)return {ok:false,status:401,message:"Authentication required."};
  const actor=claims.claims.sub;
  const [projectResult,runResult]=await Promise.all([
    supabase.from("projects").select("id,name,organization_id")
      .eq("id",choice.projectId).maybeSingle(),
    supabase.from("research_pipeline_runs")
      .select("id,organization_id,project_id,requested_by,template,requested_accession,retrieval_id,sequence_upload_id,sequence_sha256,scientific_job_id,status,failure_stage,failure_code,created_at,updated_at,finished_at")
      .eq("project_id",choice.projectId).eq("requested_by",actor)
      .in("id",choice.runIds).limit(8),
  ]);
  if(projectResult.error||runResult.error)
    return {ok:false,status:503,message:"Project or authorized pipeline evidence could not be retrieved."};
  const project=projectResult.data;
  if(!project)return {ok:false,status:404,message:"Research project not accessible."};
  const runs=runResult.data??[];
  if(runs.length!==choice.runIds.length)return {ok:false,status:404,message:"A selected pipeline is missing or inaccessible."};
  if(runs.some(r=>r.status!=="completed"||!r.scientific_job_id||!r.sequence_upload_id))
    return {ok:false,status:409,message:"Complete pipelines with scientific results are required."};
  if(runs.some(r=>r.organization_id!==project.organization_id))
    return {ok:false,status:409,message:"Pipeline project scope is inconsistent."};

  const retrievalIds=runs.map(r=>r.retrieval_id);
  const uploadIds=runs.map(r=>r.sequence_upload_id!);
  const jobIds=runs.map(r=>r.scientific_job_id!);
  const [retrievalResult,uploadResult,scienceResult,inputResult,reportIndexResult]=await Promise.all([
    supabase.from("sequence_retrievals")
      .select("id,organization_id,project_id,requested_by,status,requested_accession,source_database,sequence_upload_id,resolved_accession")
      .eq("organization_id",project.organization_id).eq("project_id",choice.projectId)
      .eq("requested_by",actor).in("id",retrievalIds).limit(8),
    supabase.from("sequence_uploads")
      .select("id,organization_id,project_id,created_by,status,sequence_count,sequence_type,sha256")
      .eq("organization_id",project.organization_id).eq("project_id",choice.projectId)
      .eq("created_by",actor).in("id",uploadIds).limit(8),
    supabase.from("scientific_jobs")
      .select("id,organization_id,project_id,requested_by,status,job_type,result_sha256")
      .eq("organization_id",project.organization_id).eq("project_id",choice.projectId)
      .eq("requested_by",actor).in("id",jobIds).limit(8),
    supabase.from("scientific_job_inputs")
      .select("job_id,project_id,sequence_upload_id,input_position,input_sha256")
      .eq("project_id",choice.projectId).in("job_id",jobIds).limit(64),
    supabase.from("scientific_reports")
      .select("id,project_id,source_resource_type,source_resource_id,generated_at")
      .eq("project_id",choice.projectId).eq("source_resource_type","scientific_job")
      .in("source_resource_id",jobIds).order("generated_at",{ascending:false}).limit(100),
  ]);
  if([retrievalResult,uploadResult,scienceResult,inputResult,reportIndexResult].some(q=>q.error))
    return {ok:false,status:503,message:"One or more source, dependency or report records could not be retrieved."};

  const src=new Map((retrievalResult.data??[]).map(x=>[x.id,x as SourceRow]));
  const seq=new Map((uploadResult.data??[]).map(x=>[x.id,x as SequenceRow]));
  const sci=new Map((scienceResult.data??[]).map(x=>[x.id,x as ScienceRow]));
  const latestReportByJob=new Map<string,string>();
  for(const report of reportIndexResult.data??[]){
    if(!latestReportByJob.has(report.source_resource_id))
      latestReportByJob.set(report.source_resource_id,report.id);
  }
  if(jobIds.some(id=>!latestReportByJob.has(id)))
    return {ok:false,status:409,message:"Generate an authoritative sealed report for every completed pipeline first."};

  // The original report seal is recalculated by the owner-scoped SQL RPC,
  // rather than treating an index row or client-supplied digest as trusted.
  const distinctReportIds=jobIds.map(id=>latestReportByJob.get(id)!);
  if(new Set(distinctReportIds).size!==distinctReportIds.length)
    return {ok:false,status:409,message:"Multiple pipelines cannot share a single report."};
  const verified=await Promise.all(distinctReportIds.map(id=>
    supabase.rpc("get_scientific_report",{report_id:id}),
  ));
  if(verified.some(v=>v.error))
    return {ok:false,status:503,message:"Report seals could not be verified."};
  const sealed=new Map<string,SealedReport>();
  for(let i=0;i<verified.length;i++){
    const rows=verified[i].data;
    if(!rows||rows.length!==1)
      return {ok:false,status:404,message:"A selected sealed report is missing."};
    sealed.set(distinctReportIds[i],rows[0] as SealedReport);
  }
  const evidence:StudySourceEvidence[]=runs.map(run=>({
    run:run as PipelineRow,
    source:src.get(run.retrieval_id)??null,
    sequence:seq.get(run.sequence_upload_id!)??null,
    science:sci.get(run.scientific_job_id!)??null,
    inputs:(inputResult.data??[]).filter(i=>i.job_id===run.scientific_job_id),
    report:sealed.get(latestReportByJob.get(run.scientific_job_id!)!)??null,
  }));
  try{
    const study=await assemblePipelineStudy(choice.projectId,choice.runIds,evidence);
    return {ok:true,study,projectName:project.name};
  }catch(error){
    if(error instanceof StudyValidationError||error instanceof DossierValidationError){
      const large=/too large|size budget/i.test(error.message);
      return {ok:false,status:large?413:409,message:large
        ?"Selected study exceeds the protected evidence size limits."
        :"One or more pipeline inputs, report seals or scientific dependency hashes failed verification."};
    }
    return {ok:false,status:503,message:"The cross-pipeline study could not be prepared."};
  }
}
