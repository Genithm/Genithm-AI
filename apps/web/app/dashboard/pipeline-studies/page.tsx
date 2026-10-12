import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { StudySelector } from "./study-selector";
import styles from "./studies.module.css";

export const dynamic="force-dynamic";
export default async function PipelineStudies(){
  const supabase=await createClient();
  const {data:claims,error:claimsError}=await supabase.auth.getClaims();
  if(claimsError||!claims?.claims?.sub)redirect("/login");
  const [projectResult,runResult]=await Promise.all([
    supabase.from("projects").select("id,name")
      .order("name",{ascending:true}).limit(100),
    supabase.from("research_pipeline_runs")
      .select("id,project_id,requested_accession,scientific_job_id,template,status,finished_at")
      .eq("requested_by",claims.claims.sub).eq("status","completed")
      .order("created_at",{ascending:false}).limit(200),
  ]);
  return <main className={"container dashboard "+styles.screen}>
    <header className={styles.hero}>
      <div><div className={styles.kicker}>Science V15 · Cross-pipeline evidence</div>
        <h1>Compare research journeys.</h1>
        <p>Curate two to eight completed NCBI-to-protein pipelines, verify every source-to-result dependency,
          compare original measurements and export one portable, reproducible study.</p></div>
      <Link className="button" href="/dashboard/pipelines">Run management</Link>
    </header>
    {projectResult.error||runResult.error?<div className="error" role="alert">
      Authorized research records could not be loaded. The study builder is unavailable.
    </div>:<StudySelector
      projects={projectResult.data??[]}
      runs={(runResult.data??[]).map(r=>({
        id:r.id,projectId:r.project_id,accession:r.requested_accession,
        finishedAt:r.finished_at,jobId:r.scientific_job_id,
      }))}
    />}
    <section className={styles.policy}>
      <strong>Evidence requirements.</strong> Only completed pipelines whose NCBI source, FASTA validation,
      scientific job input dependency and authoritative sealed report can all be reverified are included.
      The preview never silently inserts missing data or invents scientific conclusions.
    </section>
  </main>;
}
