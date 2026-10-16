import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { VariantQcWorkbench } from "./variant-qc-workbench";
import styles from "./variant-qc.module.css";

export const dynamic = "force-dynamic";
export default async function VariantQcLabPage({
  searchParams,
}: { searchParams: Promise<{error?:string;deleted?:string}> }) {
  const supabase=await createClient();
  const {data:auth,error:authError}=await supabase.auth.getClaims();
  const userId=auth?.claims?.sub;
  if(!userId||authError)redirect("/login");
  const params=await searchParams;
  const {data:projects,error:projectError}=await supabase.from("projects")
    .select("id,name").eq("status","active").order("name",{ascending:true}).limit(150);
  const projectIds=(projects??[]).map(p=>p.id);
  const {data:snapshots,error:snapshotError}=!projectError && projectIds.length
    ?await supabase.from("variant_qc_snapshots")
      .select("id,project_id,title,total_records,source_verification,created_at")
      .eq("created_by",userId).in("project_id",projectIds)
      .order("created_at",{ascending:false}).limit(24)
    :{data:[],error:null};
  const names=new Map((projects??[]).map(p=>[p.id,p.name]));
  return (
    <main className={styles.shell}>
      <nav className={styles.crumbs} aria-label="Variant QC navigation">
        <Link href="/dashboard/ai">← Genithm AI</Link>
        <Link href="/dashboard/tools">Scientific tools</Link>
        <Link href="/dashboard/results">Recorded scientific results</Link>
        <Link href="/dashboard/notebook">Research notebook</Link>
      </nav>
      <header className={styles.hero}>
        <div><span className={styles.eyebrow}>GENITHM / BIOINFORMATICS WORKBENCH</span>
          <h1>Variant QC Lab</h1>
          <p>Inspect genuine VCF variant-call files: SNV and indel counts, Ti/Tv, chromosome distribution, FILTER outcomes and QUAL histograms. No raw genomic data is uploaded to Genithm by this tool.</p>
        </div>
        <div aria-hidden="true" className={styles.heroMark}>⌘</div>
      </header>
      {params.deleted?<p role="status" className={styles.method}>QC snapshot deleted. Source VCF was never stored by Genithm.</p>:null}
      {params.error?<p role="alert" className={styles.alert}>{params.error.slice(0,180)}</p>:null}
      {projectError?<p role="alert" className={styles.warning}>Project access could not be loaded. Local VCF analysis remains available; saving is disabled.</p>:null}
      <VariantQcWorkbench projects={projectError?[]:projects??[]}/>
      <section className={styles.history} aria-label="Previously saved aggregate QC snapshots">
        <div className={styles.historyHead}>
          <div><h2>Private QC history</h2>
            <p>Only optional aggregate summaries are saved; files, variants and genotypes remain on your device.</p></div>
        </div>
        {snapshotError?<p role="alert" className={styles.alert}>Your saved QC summaries could not be loaded. No results were inferred.</p>:null}
        {!snapshotError && !snapshots?.length?<div className={styles.empty}>No saved QC summaries. Analyze a local VCF to begin.</div>:null}
        <div className={styles.savedCards}>
          {(snapshots??[]).map(item=>(
            <article className={styles.savedCard} key={item.id}>
              <strong>{item.title}</strong>
              <p>{names.get(item.project_id)??"Accessible project"} · {item.total_records.toLocaleString()} records</p>
              <p>{new Date(item.created_at).toLocaleDateString("en",{timeZone:"UTC"})} UTC · Client-computed, not server-verified</p>
              <Link href={"/dashboard/variant-qc/"+item.id}>Open aggregate QC report →</Link>
            </article>
          ))}
        </div>
        <p className={styles.small}>Showing up to 24 recent snapshots. This tool is not a clinical diagnostic pipeline or a replacement for raw-read QC or variant calling.</p>
      </section>
    </main>
  );
}
