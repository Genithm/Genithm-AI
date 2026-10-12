import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { loadResearchPipeline } from "@/lib/research-pipeline.server";
import { PipelineRefresh } from "./pipeline-refresh";
import styles from "../pipeline.module.css";

export const dynamic="force-dynamic";
function label(text:string){return text.replaceAll("_"," ")}
function when(value:string|null){return value?new Date(value).toLocaleString():"Not recorded"}
export default async function PipelineDetail({params}:{params:Promise<{id:string}>}){
  const {id}=await params;
  const outcome=await loadResearchPipeline(id);
  if(!outcome.ok){
    if(outcome.status===401) redirect("/login");
    if(outcome.status===404) notFound();
    return <main className="container dashboard"><section className="card">
      <h1>Pipeline evidence unavailable</h1>
      <p>Authorized pipeline data could not be fully retrieved. No partial or guessed stage state is displayed.</p>
      <Link className="button" href="/dashboard/pipelines">Research pipelines</Link>
    </section></main>;
  }
  const {run,projection,report}=outcome.value;
  return <main className={"container dashboard "+styles.screen}>
    <header className={styles.hero}>
      <div>
        <div className={styles.eyebrow}>Automated scientific research · Recorded evidence</div>
        <h1>{run.template==="ncbi_nucleotide_orf_v1"?"NCBI nucleotide → ORF scan":"NCBI protein → properties"}</h1>
        <p>Accession {run.requested_accession} · template {run.template}</p>
        <small className={styles.ident}>Pipeline {run.id}</small>
      </div>
      <div className={styles.links}>
        <Link href="/dashboard/pipelines" className="button">All pipelines</Link>
        <Link href="/dashboard/pipeline-studies" className="button">Pipeline studies</Link>
        <Link href="/dashboard/operations" className="button">Operations</Link>
        <a href={"/dashboard/pipelines/"+run.id+"/manifest"} className="button">Export evidence manifest</a>
      </div>
    </header>
    <section className={styles.panel}>
      <div className={styles.sectionHeader}>
        <div><div className={styles.eyebrow}>Execution state</div><h2>{label(projection.displayStatus)}</h2></div>
        <PipelineRefresh active={projection.canRefresh}/>
      </div>
      <div className={styles.metrics}>
        <div><strong>{projection.stages.length}</strong><span>Bounded stages</span></div>
        <div><strong>{label(run.status)}</strong><span>Database pipeline state</span></div>
        <div><strong>{label(projection.integrity)}</strong><span>Recorded evidence status</span></div>
      </div>
      <div className={styles.stages}>
        {projection.stages.map((stage,i)=><article key={stage.name} className={styles.stage}>
          <span className={styles.eyebrow}>{String(i+1).padStart(2,"0")} · Step</span>
          <h3>{stage.name}</h3>
          <span className={styles.state}>{label(stage.status)}</span>
          <code>{stage.id??"Job not yet dispatched"}</code>
          {stage.href?<Link href={stage.href}>Open verified scientific result →</Link>:null}
        </article>)}
      </div>
      <div className={styles.timings}>
        <span>Requested {when(run.created_at)}</span>
        <span>Last update {when(run.updated_at)}</span>
        <span>Finished {when(run.finished_at)}</span>
      </div>
    </section>
    <section className={styles.panel}>
      <div className={styles.eyebrow}>Controlled execution diagnosis</div>
      <h2>Integrity and failure information</h2>
      {projection.findings.length?<div role="alert" className={styles.warning}>
        {projection.findings.map(f=><p key={f}>{f}</p>)}
        <p>Review source and scientific records before trusting the pipeline outcome.</p>
      </div>:<p className={styles.note}>
        No cross-stage contradictions detected in the visible database metadata. A completed pipeline is still subject
        to separate byte-level scientific artifact verification and experimental interpretation.
      </p>}
      {run.failure_code?<p className={styles.warning}>
        Pipeline stopped at {label(run.failure_stage??"unknown")} · {label(run.failure_code)}.
        No automatic retry or duplicate analysis is attempted.
      </p>:null}
      {run.sequence_sha256?<p className={styles.hash}>Recorded FASTA SHA-256: <code>{run.sequence_sha256}</code></p>:null}
      {report?<div className={styles.report}>
        <strong>Sealed authoritative report available</strong>
        <code>Report SHA-256: {report.report_sha256}</code>
        <Link href={"/dashboard/reports/"+report.id}>Open report →</Link>
      </div>:run.status==="completed"?<Link className="button" href="/dashboard/reports">Generate authoritative report</Link>:null}
      <p className={styles.note}>The displayed SHA-256 values reconcile recorded metadata only. Actual downloaded scientific artifacts have a separate authenticated byte-by-byte verification path. Source freshness is fixed at retrieval time.</p>
    </section>
  </main>;
}
