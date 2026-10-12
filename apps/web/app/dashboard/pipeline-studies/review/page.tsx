import Link from "next/link";
import { notFound,redirect } from "next/navigation";
import { loadPipelineStudy } from "@/lib/pipeline-study.server";
import styles from "../studies.module.css";

export const dynamic="force-dynamic";
export default async function StudyReview({searchParams}:{
  searchParams:Promise<{project_id?:string;run_id?:string|string[]}>;
}){
  const p=await searchParams;
  const ids=typeof p.run_id==="string"?[p.run_id]:Array.isArray(p.run_id)?p.run_id:[];
  const outcome=await loadPipelineStudy(p.project_id??"",ids);
  if(!outcome.ok){
    if(outcome.status===401)redirect("/login");
    if(outcome.status===404)notFound();
    return <main className={"container dashboard "+styles.screen}>
      <section className={styles.panel}>
        <div className={styles.kicker}>Study integrity gate</div><h1>Cannot verify this research study</h1>
        <p className={styles.note}>{outcome.message}</p>
        <Link className="button" href="/dashboard/pipeline-studies">Choose different pipelines</Link>
      </section>
    </main>;
  }
  const {study,projectName}=outcome;
  const params=new URLSearchParams({project_id:study.payload.project_id});
  study.payload.pipelines.forEach(r=>params.append("run_id",r.pipeline_id));
  const columns=new Map(study.dossier.payload.reports.map((r,i)=>[r.report_id,i]));
  return <main className={"container dashboard "+styles.screen}>
    <header className={styles.hero}>
      <div><div className={styles.kicker}>Science V15 · All selected evidence reverified</div>
        <h1>Cross-pipeline study</h1>
        <p>{projectName} · {study.study_count} completed NCBI protein research chains.
          Every protein-properties job input and original report seal was checked under your current permissions.</p>
      </div>
      <div className={styles.actions}>
        <a className="button primary" href={"/dashboard/pipeline-studies/export/json?"+params}>Verified JSON</a>
        <a className="button" href={"/dashboard/pipeline-studies/export/markdown?"+params}>Markdown</a>
        <Link className="button" href="/dashboard/pipeline-studies">Change selection</Link>
      </div>
    </header>
    <section className={styles.panel}>
      <div className={styles.kicker}>Reproducible evidence package</div>
      <h2>Recorded study identity</h2>
      <div className={styles.stats}>
        <div><strong>{study.study_count}</strong><span>Linked research pipelines</span></div>
        <div><strong>{study.dossier.report_count}</strong><span>Sealed reports reverified</span></div>
        <div><strong>{study.dossier.comparison.length}</strong><span>Recorded measurements</span></div>
      </div>
      <p className={styles.note}>Canonical study payload SHA-256</p>
      <div className={styles.hash}>{study.payload_sha256}</div>
      <p className={styles.note}>This digest covers pipeline provenance and full original sealed report snapshots.
        It is a checksum—not a digital signature, independently refreshed NCBI result or proof of biological correctness.</p>
    </section>
    <section className={styles.panel}>
      <div className={styles.kicker}>Original recorded measurements</div>
      <h2>Side-by-side protein properties</h2>
      {study.dossier.comparison.length?<div className={styles.compareWrap}>
        <table className={styles.compare}>
          <thead><tr><th scope="col">Measure</th>
            {study.payload.pipelines.map(r=><th key={r.pipeline_id} scope="col">{r.accession}</th>)}
          </tr></thead>
          <tbody>{study.dossier.comparison.map(m=><tr key={m.key}>
            <th scope="row">{m.label}{m.unit?" ("+m.unit+")":""}</th>
            {study.payload.pipelines.map(r=>{
              const idx=columns.get(r.sealed_report_id);
              const v=idx===undefined?null:m.values[idx];
              return <td key={r.pipeline_id}>{v===null?"—":v.toLocaleString()}</td>;
            })}
          </tr>)}</tbody>
        </table>
      </div>:<p className={styles.note}>No numerical summary fields from the supported scientific measure allowlist were recorded in these reports.</p>}
      <p className={styles.note}>Missing is not zero. Protein properties reflect the recorded computational methods,
        not experimental activity, statistical significance or new functional equivalence claims.</p>
    </section>
    <section className={styles.panel}>
      <div className={styles.kicker}>True source-to-result provenance</div>
      <h2>Evidence included in this study</h2>
      <div className={styles.sources}>
        {study.payload.pipelines.map((r,i)=><article key={r.pipeline_id} className={styles.source}>
          <div className={styles.kicker}>Pipeline {i+1} · verified metadata</div>
          <h3>{r.accession}</h3>
          <p>Retrieval ID: {r.retrieval_id}</p>
          <p>FASTA SHA-256: {r.sequence_sha256}</p>
          <p>Scientific result SHA-256: {r.scientific_result_sha256}</p>
          <p>Report seal SHA-256: {r.sealed_report_sha256}</p>
          <Link href={"/dashboard/pipelines/"+r.pipeline_id}>Inspect original run →</Link>
          <p><Link href={"/dashboard/reports/"+r.sealed_report_id}>Inspect original sealed report →</Link></p>
        </article>)}
      </div>
    </section>
    <div className={styles.policy}><strong>Scientific boundary:</strong> This is a verified aggregation of
      previously recorded results, not a new scientific calculation. It launches no NCBI, AI or compute jobs.
      Downloaded artifact bytes and experimental claims require separate validation.</div>
  </main>;
}
