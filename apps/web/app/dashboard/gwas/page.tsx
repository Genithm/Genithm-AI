import Link from "next/link";
import {redirect} from "next/navigation";
import {createClient} from "@/lib/supabase/server";
import {GwasWorkbench} from "./gwas-workbench";
import styles from "./gwas.module.css";

export const dynamic="force-dynamic";
export default async function GwasPage(){
  const db=await createClient();const {data,error}=await db.auth.getClaims();
  if(error||!data.claims?.sub)redirect("/login");
  return <main className={styles.shell}>
    <nav className={styles.breadcrumbs} aria-label="GWAS navigation">
      <Link href="/dashboard/ai">← Genithm AI</Link><Link href="/dashboard/data">Research data</Link>
      <Link href="/dashboard/variant-qc">Variant QC</Link><Link href="/dashboard/tools">Other analyses</Link>
    </nav>
    <header className={styles.hero}><span className={styles.eyebrow}>GENITHM / GENOME-WIDE ASSOCIATION</span>
      <h1>GWAS Lab</h1><p>Run real, local genotype–phenotype association statistics. Quantitative traits use covariate-adjusted additive linear regression; 0/1 traits use covariate-adjusted logistic score tests. View Manhattan and Q–Q plots, quality-control exclusions and downloadable, source-fingerprinted results.</p></header>
    <GwasWorkbench/>
    <p className={styles.footnote}>This browser-scale laboratory extends Genithm beyond sequence-only analyses. It is not a full-scale PLINK2 or mixed-model biobank GWAS engine. No clinical inference or scientific result is invented by the AI assistant.</p>
  </main>;
}
