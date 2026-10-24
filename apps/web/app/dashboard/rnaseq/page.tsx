import Link from "next/link";
import {redirect} from "next/navigation";
import {createClient} from "@/lib/supabase/server";
import {RnaSeqPreflightWorkbench} from "./rnaseq-preflight-workbench";
import styles from "../expression/research-labs.module.css";

export const dynamic="force-dynamic";
export default async function RnaSeqIntakePage(){
  const supabase=await createClient();
  const {data,error}=await supabase.auth.getClaims();
  if(error||!data?.claims?.sub)redirect("/login");
  return <main className={styles.shell}>
    <nav className={styles.breadcrumbs} aria-label="Genithm RNA-seq study navigation">
      <Link href="/dashboard/ai">← Genithm AI</Link>
      <Link href="/dashboard/data">Research data</Link>
      <Link href="/dashboard/expression">Expression Lab</Link>
      <Link href="/dashboard/apps">All analyses</Link>
    </nav>
    <header className={styles.hero}>
      <span className={styles.eyebrow}>GENITHM / RNA-SEQ PREPARATION</span>
      <h1>Bulk RNA-seq study intake</h1>
      <p>Validate sample-to-FASTQ assignments and experimental groups before a full sequencing pipeline. This local metadata preflight is the first measured stage toward approved RNA-seq orchestration—not an already-run alignment, expression analysis or DESeq2 result.</p>
    </header>
    <RnaSeqPreflightWorkbench/>
    <p className={styles.footnote}>No FASTQ bytes leave your computer. For existing quantified raw gene counts, the separate <Link href="/dashboard/expression">Expression Lab</Link> performs bounded exploratory two-group analysis. Full FASTQ-to-counts execution still requires separately approved infrastructure and validated scientific tools.</p>
  </main>;
}
