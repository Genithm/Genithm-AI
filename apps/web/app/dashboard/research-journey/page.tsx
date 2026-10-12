import Link from "next/link";
import { redirect, notFound } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { eligibleSequence, reconcileResearchJourney } from "@/lib/research-journey";
import { requestJourneyRetrieval, requestJourneyPairwise, requestJourneyMsa } from "./actions";
import styles from "./journey.module.css";

export const dynamic="force-dynamic";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function ResearchJourney({
  searchParams,
}: {
  searchParams:Promise<{project_id?:string;error?:string}>;
}) {
  const args=await searchParams;
  const supabase=await createClient();
  const {data:claims}=await supabase.auth.getClaims();
  if(!claims?.claims?.sub) redirect("/login");
  const {data:projects,error:projectsError}=await supabase.from("projects")
    .select("id,name,status").eq("status","active").order("name",{ascending:true}).limit(100);
  const selected=args.project_id??projects?.[0]?.id??"";
  if(args.project_id && !UUID.test(selected)) notFound();
  if(selected && !projects?.some(p=>p.id===selected)) notFound();
  const [retrievals,uploads,jobs,inputs,reports]=selected?await Promise.all([
    supabase.from("sequence_retrievals")
      .select("id,project_id,status,source_database,requested_accession,resolved_accession,sequence_upload_id,created_at,source_retrieved_at")
      .eq("project_id",selected).order("created_at",{ascending:false}).limit(80),
    supabase.from("sequence_uploads")
      .select("id,project_id,status,sequence_type,sequence_count,sha256,original_filename")
      .eq("project_id",selected).order("created_at",{ascending:false}).limit(150),
    supabase.from("scientific_jobs")
      .select("id,project_id,job_type,status,result_sha256,created_at")
      .eq("project_id",selected).order("created_at",{ascending:false}).limit(150),
    supabase.from("scientific_job_inputs")
      .select("job_id,project_id,sequence_upload_id,input_position")
      .eq("project_id",selected).limit(500),
    supabase.from("scientific_reports")
      .select("id,project_id,source_resource_type,source_resource_id,report_sha256,generated_at")
      .eq("project_id",selected).order("generated_at",{ascending:false}).limit(150),
  ]):Array.from({length:5},()=>({data:[],error:null}));
  const hasError=projectsError||[retrievals,uploads,jobs,inputs,reports].some(r=>r.error);
  const sequenceRows=uploads.data??[];
  const sources=hasError?[]:reconcileResearchJourney(selected,retrievals.data??[],
    sequenceRows,jobs.data??[],inputs.data??[],reports.data??[]);
  const ready=sequenceRows.filter(row=>row.status==="ready" && row.sequence_count===1 &&
    (eligibleSequence(row,"protein")||eligibleSequence(row,"nucleotide")));
  const completeReports=(reports.data??[]).length;
  return <main className={"container dashboard "+styles.screen}>
    <header className={styles.hero}>
      <div>
        <div className={styles.eyebrow}>Science V13 · Connected research execution</div>
        <h1>From accession to evidence.</h1>
        <p>Retrieve current NCBI source data, use validated sequences in scientific tools, and follow their recorded lineage through finalized, sealed reports.</p>
      </div>
      <div className={styles.links}>
        <Link className="button" href="/dashboard/ai">AI research assistant</Link>
        <Link className="button" href="/dashboard/dossiers">Research dossiers</Link>
        <Link className="button" href="/dashboard/pipelines">Autonomous pipelines</Link>
      </div>
    </header>
    <form className={styles.projectSelector} action="/dashboard/research-journey" method="get">
      <label htmlFor="research-project">Research project</label>
      <select id="research-project" name="project_id" defaultValue={selected}>
        {(projects??[]).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <button className="button" type="submit">Open project</button>
    </form>
    {args.error?<div className="error" role="alert">{args.error.slice(0,200)}</div>:null}
    {hasError?<div className="error" role="alert">One or more authorized research evidence sources could not be retrieved. No incomplete lineage is displayed.</div>:null}
    {!selected?<section className={styles.panel}><h2>Create a research project to begin</h2><p>Projects securely organize accessions, sequence inputs, computations and reports.</p><Link className="button" href="/dashboard/tools">Create project</Link></section>:null}
    {selected&&!hasError?<>
      <div className={styles.metrics}>
        <div><strong>{sources.length}</strong><span>Recent NCBI requests</span></div>
        <div><strong>{ready.length}</strong><span>Ready sequences</span></div>
        <div><strong>{(jobs.data??[]).length}</strong><span>Recent scientific jobs</span></div>
        <div><strong>{completeReports}</strong><span>Sealed reports</span></div>
      </div>
      <div className={styles.actionGrid}>
        <section className={styles.panel}>
          <div className={styles.eyebrow}>01 · Source acquisition</div>
          <h2>Retrieve an NCBI sequence</h2>
          <p className={styles.hint}>Each request queues one accession against the current upstream NCBI source. Source freshness is recorded by the retrieval worker.</p>
          <form action={requestJourneyRetrieval} className={styles.form}>
            <input type="hidden" name="project_id" value={selected}/>
            <label>Database<select name="database" defaultValue="nucleotide">
              <option value="nucleotide">Nucleotide</option><option value="protein">Protein</option>
            </select></label>
            <label>Accession<input name="accession" maxLength={64} required placeholder="NM_000546.6"/></label>
            <button className="button primary" type="submit">Queue source retrieval</button>
          </form>
        </section>
        <section className={styles.panel}>
          <div className={styles.eyebrow}>02 · Scientific execution</div>
          <h2>Compare two validated sequences</h2>
          <p className={styles.hint}>Launch global pairwise alignment using approved default scoring. The server revalidates project scope, sequence count, and type compatibility.</p>
          <form action={requestJourneyPairwise} className={styles.form}>
            <input type="hidden" name="project_id" value={selected}/>
            <label>Sequence A<select name="sequence_a" required defaultValue="">
              <option value="" disabled>Select a sequence</option>
              {ready.map(u=><option key={u.id} value={u.id}>{(u.original_filename??"Sequence").slice(0,55)} · {u.sequence_type} · {u.id.slice(0,8)}</option>)}
            </select></label>
            <label>Sequence B<select name="sequence_b" required defaultValue="">
              <option value="" disabled>Select a different sequence</option>
              {ready.map(u=><option key={u.id} value={u.id}>{(u.original_filename??"Sequence").slice(0,55)} · {u.sequence_type} · {u.id.slice(0,8)}</option>)}
            </select></label>
            <button className="button primary" type="submit" disabled={ready.length<2}>Run pairwise alignment</button>
          </form>
        </section>
        <section className={styles.panel}>
          <div className={styles.eyebrow}>03 · Multi-sequence research</div>
          <h2>MAFFT alignment</h2>
          <p className={styles.hint}>Select 3–50 validated single-record FASTA inputs of one compatible type; use the resulting MSA to build a FastTree phylogeny.</p>
          <form action={requestJourneyMsa} className={styles.form}>
            <input type="hidden" name="project_id" value={selected}/>
            <fieldset className={styles.sequenceSet}><legend>Select compatible sequences</legend>
              {ready.slice(0,50).map(u=><label className={styles.check} key={u.id}>
                <input type="checkbox" name="sequence_upload_ids" value={u.id}/>
                <span>{(u.original_filename??"Sequence").slice(0,65)} · {u.sequence_type} · {u.id.slice(0,8)}</span>
              </label>)}
              {!ready.length?<p className={styles.hint}>No validated sequences available.</p>:null}
            </fieldset>
            <button className="button primary" type="submit" disabled={ready.length<3}>Queue MAFFT alignment</button>
          </form>
        </section>
        <section className={styles.panel}>
          <div className={styles.eyebrow}>04 · Interpretation and reproducibility</div>
          <h2>Build defensible evidence</h2>
          <p className={styles.hint}>Inspect finished scientific output, generate a sealed authoritative report and group reports into a reproducible dossier. AI interpretation remains separate from scientific measurements.</p>
          <div className={styles.columnLinks}>
            <Link className="button" href="/dashboard/operations">Track running jobs</Link>
            <Link className="button" href="/dashboard/reports">Generate sealed reports</Link>
            <Link className="button primary" href="/dashboard/dossiers">Build research dossier</Link>
          </div>
        </section>
      </div>
      <section className={styles.panel}>
        <div className={styles.eyebrow}>Actual recorded provenance</div>
        <h2>NCBI → FASTA → scientific jobs → reports</h2>
        <p className={styles.hint}>Only relationships recorded through source retrieval upload IDs and scientific job input IDs are shown. This screen never infers an analysis link merely because two jobs share a project or sequence name.</p>
        <div className={styles.journeyList}>
          {sources.map(j=><article key={j.retrieval.id} className={styles.journey}>
            <div className={styles.journeyTop}>
              <div><strong>{j.retrieval.resolved_accession??j.retrieval.requested_accession}</strong>
                <small>{j.retrieval.source_database} · requested {new Date(j.retrieval.created_at).toLocaleString()}</small></div>
              <span className={styles.state}>{j.state.replaceAll("_"," ")}</span>
            </div>
            <div className={styles.steps}>
              <div><span>01 / Source</span><strong>{j.retrieval.status.replaceAll("_"," ")}</strong></div>
              <div><span>02 / Validated FASTA</span><strong>{j.upload?.status??"Not yet linked"}</strong>
                {j.upload?<code>{j.upload.id}</code>:null}</div>
              <div><span>03 / Analyses</span><strong>{j.analyses.length} linked</strong></div>
              <div><span>04 / Sealed reports</span><strong>{j.retrievalReports.length+j.analyses.reduce((sum,a)=>sum+a.reports.length,0)} linked</strong></div>
            </div>
            <p className={styles.hint}>{j.guidance}</p>
            {j.analyses.length?<div className={styles.linkedList}>
              {j.analyses.map(a=><div key={a.id}>
                <Link href={"/dashboard/scientific-jobs/"+a.id}>{a.job_type.replaceAll("_"," ")} · {a.status.replaceAll("_"," ")} ↗</Link>
                <small>Input positions {a.positions.join(", ")}</small>
                {a.reports.map(r=><Link key={r.id} href={"/dashboard/reports/"+r.id}>Sealed report ↗</Link>)}
              </div>)}
            </div>:null}
            {j.retrievalReports.length?<div className={styles.linkedList}>
              {j.retrievalReports.map(r=><Link key={r.id} href={"/dashboard/reports/"+r.id}>Source retrieval report ↗</Link>)}
            </div>:null}
          </article>)}
          {!sources.length?<p className={styles.hint}>No recent NCBI retrievals. Start one above, or analyze previously uploaded validated FASTA sequences.</p>:null}
        </div>
      </section>
      <p className={styles.hint}>This is a guided, auditable research journey rather than an unattended multi-job agent. Jobs are dispatched only by explicit authorized actions, except the existing approved MSA-to-phylogeny workflow. Data sources use bounded recent snapshots; links may be absent if older inputs fall outside the selected window.</p>
    </>:null}
  </main>;
}
