import Link from "next/link";
import {redirect} from "next/navigation";
import {createClient} from "@/lib/supabase/server";
import {ExpressionWorkbench} from "./expression-workbench";
import styles from "./research-labs.module.css";

export const dynamic = "force-dynamic";
export default async function ExpressionPage() {
  const db = await createClient();
  const {data, error} = await db.auth.getClaims();
  if (error || !data?.claims?.sub) redirect("/login");
  return <main className={styles.shell}>
    <nav className={styles.breadcrumbs} aria-label="RNA-seq lab navigation">
      <Link href="/dashboard/ai">← Genithm AI</Link>
      <Link href="/dashboard/data">Research data</Link>
      <Link href="/dashboard/pathways">Pathway Enrichment</Link>
      <Link href="/dashboard/apps">All analyses</Link>
    </nav>
    <header className={styles.hero}>
      <span className={styles.eyebrow}>GENITHM / TRANSCRIPTOMICS</span>
      <h1>RNA Expression Lab</h1>
      <p>Run a real, bounded exploratory two-group differential-expression analysis from an existing raw gene-count matrix and matched sample conditions. Results include sample library QC, normalized counts, a sample PCA, Welch tests, BH adjusted P-values and exportable gene lists for pathway enrichment.</p>
    </header>
    <ExpressionWorkbench />
    <p className={styles.footnote}>This method tests log2 normalized CPM with Welch statistics: it is <strong>not</strong> the negative-binomial DESeq2/edgeR model. It does not quantify FASTQ reads, align RNA-seq data, adjust for batch/covariates or persist official research jobs.</p>
  </main>;
}
