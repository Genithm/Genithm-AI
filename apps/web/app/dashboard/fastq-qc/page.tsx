import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { FastqQcWorkbench } from "./fastq-qc-workbench";
import styles from "./fastq-qc.module.css";

export const dynamic="force-dynamic";

export default async function FastqQcLab({
  searchParams,
}:{searchParams:Promise<{error?:string;deleted?:string}>}){
  const supabase=await createClient();
  const {data:auth,error:authError}=await supabase.auth.getClaims();
  const userId=auth?.claims?.sub;
  if(!userId||authError)redirect("/login");
  const params=await searchParams;
  const {data:projects,error:projectError}=await supabase.from("projects")
    .select("id,name").eq("status","active").order("name",{ascending:true}).limit(150);
  const ids=(projects??[]).map(p=>p.id);
  const {data:snapshots,error:historyError}=!projectError&&ids.length
    ?await supabase.from("fastq_qc_snapshots")
      .select("id,title,mode,read_count,project_id,created_at")
      .eq("created_by",userId).in("project_id",ids)
      .order("created_at",{ascending:false}).limit(24)
    :{data:[],error:null};
  const nameById=new Map((projects??[]).map(p=>[p.id,p.name]));
  return <main className={styles.shell}>
    <nav className={styles.breadcrumbs} aria-label="FASTQ quality control navigation">
      <Link href="/dashboard/ai">← Genithm AI</Link>
      <Link href="/dashboard/tools">Scientific tools</Link>
      <Link href="/dashboard/variant-qc">Variant QC Lab</Link>
      <Link href="/dashboard/results">Scientific results</Link>
    </nav>
    <header className={styles.hero}>
      <span className={styles.eyebrow}>GENITHM / SEQUENCING BIOINFORMATICS</span>
      <h1>FASTQ QC Lab</h1>
      <p>Calculate actual sequencing quality from single-end or paired-end FASTQ reads. Explore Q20/Q30, Phred-by-cycle, GC and read length distributions. All raw reads stay in your browser; optional project storage contains aggregate statistics only.</p>
    </header>
    {params.error?<p className={styles.error} role="alert">{params.error.slice(0,180)}</p>:null}
    {params.deleted?<p className={styles.success} role="status">Saved QC aggregate deleted. No FASTQ files were stored.</p>:null}
    {projectError?<p className={styles.error} role="alert">Project access unavailable. You can analyze locally but cannot save.</p>:null}
    <FastqQcWorkbench projects={projectError?[]:projects??[]}/>
    <section className={styles.history} aria-label="Private saved FASTQ QC aggregates">
      <h2>Private QC history</h2>
      <p className={styles.small}>Your saved read-quality aggregates, not raw sequencing reads. Only the record owner can access the entries.</p>
      {historyError?<p className={styles.error} role="alert">Saved QC history unavailable.</p>:null}
      {!historyError&&!snapshots?.length?<div className={styles.empty}>No FASTQ QC summaries saved yet.</div>:null}
      <div className={styles.savedGrid}>
        {(snapshots??[]).map(item=><article className={styles.savedCard} key={item.id}>
          <strong>{item.title}</strong>
          <small>{item.mode==="paired"?"Paired-end":"Single-end"} · {item.read_count.toLocaleString()} reads per file</small>
          <small>{nameById.get(item.project_id)??"Accessible project"} · {new Date(item.created_at).toLocaleDateString("en",{timeZone:"UTC"})} UTC</small>
          <Link href={"/dashboard/fastq-qc/"+item.id}>Open aggregate quality report →</Link>
        </article>)}
      </div>
      <p className={styles.small}>Displaying up to 24 recent reports. Raw FASTQ files are never uploaded by this lab.</p>
    </section>
  </main>;
}
