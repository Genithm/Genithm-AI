"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { eligibleSequence } from "@/lib/research-journey";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const accession=/^(?=.*[A-Z])[A-Z0-9_]+(?:\.[0-9]+)?$/;
const home=(id:string)=>"/dashboard/research-journey?project_id="+encodeURIComponent(id);
function failure(id:string,message:string):never {
  redirect(home(id)+"&error="+encodeURIComponent(message));
}
async function scoped(projectId:string){
  if(!UUID.test(projectId)) redirect("/dashboard/research-journey?error=Choose+a+valid+project.");
  const supabase=await createClient();
  const {data:claims,error:authError}=await supabase.auth.getClaims();
  if(authError || !claims?.claims?.sub) redirect("/login");
  const {data:project,error}=await supabase.from("projects")
    .select("id,organization_id,status").eq("id",projectId).maybeSingle();
  if(error||!project||project.status!=="active") failure(projectId,"Project is not accessible or active.");
  return {supabase,project};
}

/** Each submission requests ONE bounded retrieval using the approved database RPC. */
export async function requestJourneyRetrieval(form:FormData) {
  const projectId=String(form.get("project_id")??"");
  const {supabase}=await scoped(projectId);
  const database=String(form.get("database")??"").toLowerCase();
  const value=String(form.get("accession")??"").trim().toUpperCase();
  if(!["protein","nucleotide"].includes(database)||value.length>64||!accession.test(value))
    failure(projectId,"Choose a supported NCBI database and enter a valid accession.");
  const {error}=await supabase.rpc("request_ncbi_sequence_retrieval",{
    project_id:projectId,database_name:database,accession:value,
  });
  if(error) failure(projectId,"NCBI retrieval could not be queued. Check access, limits and current jobs.");
  revalidatePath(home(projectId));
  redirect(home(projectId));
}
async function authorizedUploads(projectId:string,ids:string[]){
  const {supabase}=await scoped(projectId);
  if(ids.length<1||ids.length>50||new Set(ids).size!==ids.length||ids.some(id=>!UUID.test(id)))
    failure(projectId,"Select distinct valid input sequences.");
  const {data,error}=await supabase.from("sequence_uploads")
    .select("id,project_id,status,sequence_count,sequence_type,sha256")
    .eq("project_id",projectId).in("id",ids);
  if(error||!data||data.length!==ids.length) failure(projectId,"Sequence evidence is missing or unauthorized.");
  return {supabase,uploads:data};
}
export async function requestJourneyPairwise(form:FormData) {
  const id=String(form.get("project_id")??"");
  const a=String(form.get("sequence_a")??"");
  const b=String(form.get("sequence_b")??"");
  if(a===b) failure(id,"Select two different validated sequences.");
  const {supabase,uploads}=await authorizedUploads(id,[a,b]);
  const types=new Set(uploads.map(u=>u.sequence_type));
  if(types.size!==1||!uploads.every(u=>eligibleSequence(u,
      u.sequence_type==="protein"?"protein":"nucleotide")))
    failure(id,"Pairwise alignment requires two ready, single-record sequences of the same type.");
  const {data,error}=await supabase.rpc("request_pairwise_alignment",{
    project_id:id,sequence_a_id:a,sequence_b_id:b,
    algorithm:"global",match_score:2,mismatch_score:-1,gap_score:-2,
  });
  if(error||typeof data!=="string") failure(id,"Pairwise computation was not accepted. Check compute limits.");
  revalidatePath(home(id));
  redirect("/dashboard/scientific-jobs/"+data);
}
export async function requestJourneyMsa(form:FormData) {
  const id=String(form.get("project_id")??"");
  const ids=form.getAll("sequence_upload_ids").map(v=>String(v));
  if(ids.length<3||ids.length>50) failure(id,"MAFFT requires three to fifty distinct sequences.");
  const {supabase,uploads}=await authorizedUploads(id,ids);
  const types=new Set(uploads.map(u=>u.sequence_type));
  if(types.size!==1||!uploads.every(u=>eligibleSequence(u,
      u.sequence_type==="protein"?"protein":"nucleotide")))
    failure(id,"MSA requires compatible single-record validated sequences from this project.");
  const {data,error}=await supabase.rpc("request_multiple_sequence_alignment",{
    project_id:id,sequence_upload_ids:ids,
  });
  if(error||typeof data!=="string") failure(id,"MAFFT request failed validation or compute limits.");
  revalidatePath(home(id));
  redirect("/dashboard/scientific-jobs/"+data);
}
