import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { startAutonomousProteinPipeline } from "./actions";
import styles from "./pipeline.module.css";

export const dynamic="force-dynamic";
function readable(value:string){return value.replaceAll("_"," ")}
export default async function ResearchPipelines({searchParams}:{
  searchParams:Promise<{error?:string}>;
}){
  const params=await searchParams;
  const supabase=await createClient();
  const {data:claims}=await supabase.auth.getClaims();
  if(!claims?.claims?.sub) redirect("/login");
  const [projectResult,runResult]=await Promise.all([
    supabase.from("projects").select("id,name,status")
      .eq("status","active").order("name",{ascending:true}).limit(100),
    supabase.from("research_pipeline_runs")
      .select("id,project_id,requested_accession,status,template,scientific_job_id,failure_stage,created_at,updated_at")
      .order("created_at",{ascending:false}).limit(100),
  ]);
  const projects=projectResult.data??[];
  const names=new Map(projects.map(x=>[x.id,x.name]));
  const enabled=!runResult.error;
  return <main className={"container dashboard "+styles.screen}>
    <header className={styles.hero}>
      <div>
        <div className={styles.eyebrow}>Science V14 · Approved autonomous execution</div>
        <h1>Research pipeline engine.</h1>
        <p>One explicit approval for a narrowly defined, auditable chain:
          NCBI protein accession → validated FASTA → protein-properties computation.</p>
      </div>
      <div className={styles.links}>
        <Link className="button" href="/dashboard/research-journey">Guided research</Link>
        <Link className="button" href="/dashboard/operations">Operations center</Link>
      </div>
    </header>
    {params.error?<div className="error" role="alert">{params.error.slice(0,250)}</div>:null}
    {projectResult.error?<div className="error" role="alert">Project authorization could not be retrieved.</div>:null}
    {!enabled?<div className="error" role="status">
      The autonomous pipeline schema is not available in this environment. The V14 database migration
      must be reviewed and deployed before this feature can be used. No jobs were started.
    </div>:null}
    <div className={styles.columns}>
      <section className={styles.panel}>
        <div className={styles.eyebrow}>Launch approved workflow</div>
        <h2>NCBI protein profile</h2>
        <p>Source data is fetched from NCBI at execution time. An existing authorized NCBI
          retrieval may be reused safely, but never a retrieval owned by another researcher.</p>
        <div className={styles.steps}>
          <span>01 NCBI source</span><span>02 FASTA validation</span><span>03 Protein calculation</span>
        </div>
        <form action={startAutonomousProteinPipeline} className={styles.form}>
          <label>Active project<select name="project_id" required defaultValue={projects[0]?.id??""} disabled={!enabled}>
            <option value="" disabled>Choose project</option>
            {projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
          </select></label>
          <label>NCBI protein accession<input name="accession" required maxLength={64}
            disabled={!enabled} placeholder="NP_000537.3" autoComplete="off"/></label>
          <label className={styles.consent}>
            <input type="checkbox" value="yes" name="confirm_automatic_analysis" required disabled={!enabled}/>
            <span>I authorize one NCBI protein retrieval and one downstream protein-properties calculation.
              The second step can start automatically only after source and FASTA validation succeed.</span>
          </label>
          <button type="submit" className="button primary" disabled={!enabled||!projects.length}>
            Approve and start pipeline
          </button>
        </form>
        <p className={styles.note}>The workflow is bounded to this template only. No arbitrary AI-generated commands,
          repeat-until-success retries, BLAST searches, mutations or unapproved external analysis are authorized.</p>
      </section>
      <section className={styles.panel}>
        <div className={styles.eyebrow}>Operational safeguards</div>
        <h2>Every step has evidence.</h2>
        <div className={styles.safeguards}>
          <div><strong>Serialized advancement</strong><span>Row-locked state transitions make duplicate worker completion events safe.</span></div>
          <div><strong>Validated inputs only</strong><span>Strict single-record protein type, SHA-256, size and no-gap checks.</span></div>
          <div><strong>Fail closed</strong><span>Source rejection, validation failures or compute dispatch rejection stop the pipeline.</span></div>
          <div><strong>No unsafe replay</strong><span>Failed workflows are terminal; a new explicit authorization is required to start another.</span></div>
        </div>
      </section>
    </div>
    <section className={styles.panel}>
      <div className={styles.sectionHeader}>
        <div><div className={styles.eyebrow}>Owner-scoped recent pipeline runs</div><h2>Active and completed research</h2></div>
        <span className={styles.note}>Showing up to 100 recently visible runs · refresh page for updates</span>
      </div>
      <div className={styles.runList}>
        {(runResult.data??[]).map(run=><Link key={run.id} href={"/dashboard/pipelines/"+run.id} className={styles.run}>
          <div><strong>{run.requested_accession}</strong>
            <small>{names.get(run.project_id)??"Authorized project"} · {new Date(run.created_at).toLocaleString()}</small></div>
          <span className={styles.state}>{readable(run.status)}</span>
          <span className={styles.open}>Inspect stages →</span>
        </Link>)}
        {enabled&&!(runResult.data??[]).length?<p className={styles.note}>
          No autonomous pipelines have been created for this account yet.
        </p>:null}
      </div>
    </section>
  </main>;
}
