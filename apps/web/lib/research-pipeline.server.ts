import "server-only";

import { createClient } from "@/lib/supabase/server";
import {
  reconcilePipeline, type PipelineProjection, type PipelineRow,
  type SourceRow, type SequenceRow, type ScienceRow,
} from "@/lib/research-pipeline";

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export type VerifiedPipeline = {
  run: PipelineRow;
  projection: PipelineProjection;
  report: { id: string; report_sha256: string } | null;
  source: SourceRow | null;
  sequence: SequenceRow | null;
  science: ScienceRow | null;
};
export async function loadResearchPipeline(id:string):Promise<
  |{ok:true;value:VerifiedPipeline}
  |{ok:false;status:401|404|503}
>{
  if(!UUID.test(id)) return {ok:false,status:404};
  const supabase=await createClient();
  const {data:claims,error:authError}=await supabase.auth.getClaims();
  if(authError||!claims?.claims?.sub) return {ok:false,status:401};
  const {data:run,error:runError}=await supabase.from("research_pipeline_runs")
    .select("id,organization_id,project_id,requested_by,template,requested_accession,retrieval_id,sequence_upload_id,sequence_sha256,scientific_job_id,status,failure_stage,failure_code,created_at,updated_at,finished_at")
    .eq("id",id).eq("requested_by",claims.claims.sub).maybeSingle();
  if(runError) return {ok:false,status:503};
  if(!run) return {ok:false,status:404};
  const [sourceResult,seqResult,scienceResult,reportResult]=await Promise.all([
    supabase.from("sequence_retrievals")
      .select("id,organization_id,project_id,requested_by,status,requested_accession,source_database,sequence_upload_id,resolved_accession")
      .eq("id",run.retrieval_id).eq("project_id",run.project_id)
      .eq("organization_id",run.organization_id).eq("requested_by",run.requested_by).maybeSingle(),
    run.sequence_upload_id
      ?supabase.from("sequence_uploads")
        .select("id,organization_id,project_id,created_by,status,sequence_count,sequence_type,sha256")
        .eq("id",run.sequence_upload_id).eq("project_id",run.project_id)
        .eq("organization_id",run.organization_id).eq("created_by",run.requested_by).maybeSingle()
      :Promise.resolve({data:null,error:null}),
    run.scientific_job_id
      ?supabase.from("scientific_jobs")
        .select("id,organization_id,project_id,requested_by,status,job_type,result_sha256,parameters")
        .eq("id",run.scientific_job_id).eq("project_id",run.project_id)
        .eq("organization_id",run.organization_id).eq("requested_by",run.requested_by).maybeSingle()
      :Promise.resolve({data:null,error:null}),
    run.scientific_job_id
      ?supabase.from("scientific_reports")
        .select("id,report_sha256").eq("project_id",run.project_id)
        .eq("source_resource_type","scientific_job")
        .eq("source_resource_id",run.scientific_job_id).order("generated_at",{ascending:false})
        .limit(1).maybeSingle()
      :Promise.resolve({data:null,error:null}),
  ]);
  if([sourceResult,seqResult,scienceResult,reportResult].some(r=>r.error))
    return {ok:false,status:503};
  try{
    const record=run as PipelineRow;
    return {ok:true,value:{
      run:record,
      source:sourceResult.data as SourceRow|null,
      sequence:seqResult.data as SequenceRow|null,
      science:scienceResult.data as ScienceRow|null,
      report:reportResult.data,
      projection:reconcilePipeline(record,sourceResult.data as SourceRow|null,
        seqResult.data as SequenceRow|null,scienceResult.data as ScienceRow|null),
    }};
  }catch{
    return {ok:false,status:503};
  }
}
