import Link from "next/link";
import { notFound,redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { validateFastqQcSummary } from "@/lib/fastq-quality-control";
import { deleteFastqQcSnapshot } from "../actions";
import { FastqQcVisualization } from "../fastq-qc-visualization";
import styles from "../fastq-qc.module.css";

export const dynamic="force-dynamic";
const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
export default async function SavedFastqQc({params}:{params:Promise<{id:string}>}){
  const {id}=await params;
  if(!UUID.test(id))notFound();
  const supabase=await createClient();
  const {data:auth,error:authError}=await supabase.auth.getClaims();
  const owner=auth?.claims?.sub;
  if(authError||!owner)redirect("/login");
  const {data:record,error}=await supabase.from("fastq_qc_snapshots")
    .select("id,title,mode,read_count,summary,source_hashes,source_verification,created_at")
    .eq("id",id).eq("created_by",owner).maybeSingle();
  if(error||!record)notFound();
  const candidate=record.summary;
  const summary=validateFastqQcSummary(candidate)&&
    candidate.mode===record.mode&&candidate.reads[0].readCount===record.read_count&&
    candidate.reads.length===record.source_hashes.length &&
    record.source_hashes.every(h=>/^[a-f0-9]{64}$/.test(h)) &&
    record.source_verification==="client_computed_unverified"
      ?candidate:null;
  return <main className={styles.shell}>
    <nav className={styles.breadcrumbs}>
      <Link href="/dashboard/fastq-qc">← FASTQ QC Lab</Link>
      <Link href="/dashboard/ai">Genithm AI</Link>
      <Link href="/dashboard/variant-qc">Variant QC Lab</Link>
    </nav>
    <header className={styles.hero}>
      <span className={styles.eyebrow}>GENITHM / SAVED READ QC</span>
      <h1>{record.title}</h1>
      <p>Saved {new Date(record.created_at).toLocaleString("en",{timeZone:"UTC"})} UTC. These are browser-computed aggregate quality metrics, not independently server-verified evidence.</p>
    </header>
    {summary?<>
      <FastqQcVisualization summary={summary} hashes={record.source_hashes} saved/>
      <a className={styles.secondary} style={{justifySelf:"start",textDecoration:"none"}}
        href={"/dashboard/fastq-qc/"+id+"/export"}>↓ Export saved FASTQ QC TSV</a>
    </>:<p className={styles.error} role="alert">Stored QC metrics failed validation. No report is displayed.</p>}
    <section className={styles.panel}>
      <h2>Manage saved aggregate</h2>
      <p className={styles.small}>Removing this record does not delete any sequencing file, because none was uploaded by this feature.</p>
      <form action={deleteFastqQcSnapshot}>
        <input type="hidden" name="snapshot_id" value={id}/>
        <button type="submit" className={styles.deleteButton}>Delete saved FASTQ QC aggregate</button>
      </form>
    </section>
  </main>;
}
