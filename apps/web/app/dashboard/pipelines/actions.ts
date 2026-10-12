"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const ACC=/^(?=.*[A-Z])[A-Z0-9_]+(?:\.[0-9]+)?$/;

export async function startAutonomousProteinPipeline(form:FormData){
  const projectId=String(form.get("project_id")??"");
  const accession=String(form.get("accession")??"").trim().toUpperCase();
  const consent=form.get("confirm_automatic_analysis")==="yes";
  if(!UUID.test(projectId)||!consent||accession.length>64||!ACC.test(accession))
    redirect("/dashboard/pipelines?error="+encodeURIComponent("Choose an accessible project, valid protein accession and approve exactly one downstream analysis."));
  const supabase=await createClient();
  const {data:claims,error:authError}=await supabase.auth.getClaims();
  if(authError || !claims?.claims?.sub) redirect("/login");
  // The narrow database RPC binds actor, project and retrieval and advances
  // only the preapproved protein-properties template. The browser cannot choose
  // a generic action name or bypass job queue quotas.
  const {data,error}=await supabase.rpc("request_research_protein_pipeline",{
    project_id:projectId,accession,
  });
  if(error||typeof data!=="string"||!UUID.test(data))
    redirect("/dashboard/pipelines?error="+encodeURIComponent("Pipeline was not accepted. Check database rollout, project permissions, active retrieval ownership and scientific compute limits."));
  revalidatePath("/dashboard/pipelines");
  redirect("/dashboard/pipelines/"+data);
}
