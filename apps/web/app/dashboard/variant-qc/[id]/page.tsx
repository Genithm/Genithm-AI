import Link from "next/link";
import { notFound,redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { validateVcfQcSummary } from "@/lib/vcf-quality-control";
import { deleteVariantQcSnapshot } from "../actions";
import { VariantQcSummary } from "../variant-qc-summary";
import styles from "../variant-qc.module.css";

export const dynamic="force-dynamic";
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

export default async function SavedVariantQcPage({params}:{
  params:Promise<{id:string}>;
}) {
  const {id}=await params;
  if(!UUID.test(id))notFound();
  const supabase=await createClient();
  const {data:auth,error:authError}=await supabase.auth.getClaims();
  const userId=auth?.claims?.sub;
  if(!userId||authError)redirect("/login");
  const {data:record,error}=await supabase.from("variant_qc_snapshots")
    .select("id,title,project_id,source_sha256,source_verification,summary,total_records,created_at")
    .eq("id",id).eq("created_by",userId).maybeSingle();
  if(error||!record)notFound();
  const valid=validateVcfQcSummary(record.summary)&&
    record.summary.totalRecords===record.total_records &&
    record.source_verification==="client_computed_unverified";
  return (
    <main className={styles.shell}>
      <nav className={styles.crumbs}>
        <Link href="/dashboard/variant-qc">← Variant QC Lab</Link>
        <Link href="/dashboard/results">Scientific results</Link>
        <Link href="/dashboard/notebook">Research notebook</Link>
      </nav>
      <header className={styles.hero}>
        <div><span className={styles.eyebrow}>GENITHM / SAVED AGGREGATE QC</span>
          <h1>{record.title}</h1>
          <p>Saved {new Date(record.created_at).toLocaleString("en",{timeZone:"UTC"})} UTC.
            These values were computed in the researcher's browser; no server-side VCF source verification is claimed.</p>
        </div>
      </header>
      {valid?(
        <>
          <VariantQcSummary summary={record.summary} sourceSha256={record.source_sha256} saved/>
          <a className={styles.primary} style={{justifySelf:"start",textDecoration:"none"}}
            href={"/dashboard/variant-qc/"+id+"/export"}>↓ Download saved aggregate TSV</a>
        </>
      ):<p role="alert" className={styles.alert}>This saved QC summary is malformed or unsupported. No result metrics are displayed.</p>}
      <section className={styles.history}>
        <h2>Manage snapshot</h2>
        <p className={styles.small}>Deleting this snapshot removes only aggregate statistics from Supabase; raw VCF files and variant-level data were never uploaded by this tool.</p>
        <form action={deleteVariantQcSnapshot} className={styles.delete}>
          <input type="hidden" name="snapshot_id" value={id}/>
          <button type="submit">Delete saved QC summary</button>
        </form>
      </section>
    </main>
  );
}
