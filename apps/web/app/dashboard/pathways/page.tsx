import Link from "next/link";
import {redirect} from "next/navigation";
import {createClient} from "@/lib/supabase/server";
import {PathwayWorkbench} from "./pathway-workbench";
import styles from "../expression/research-labs.module.css";

export const dynamic = "force-dynamic";
export default async function PathwayPage() {
  const db = await createClient();
  const {data, error} = await db.auth.getClaims();
  if (error || !data?.claims?.sub) redirect("/login");
  return <main className={styles.shell}>
    <nav className={styles.breadcrumbs} aria-label="Pathway lab navigation">
      <Link href="/dashboard/ai">← Genithm AI</Link>
      <Link href="/dashboard/expression">RNA Expression Lab</Link>
      <Link href="/dashboard/data">Research data</Link>
      <Link href="/dashboard/apps">All analyses</Link>
    </nav>
    <header className={styles.hero}>
      <span className={styles.eyebrow}>GENITHM / SYSTEMS BIOLOGY</span>
      <h1>Pathway Enrichment Lab</h1>
      <p>Test whether selected genes overlap your provided pathways more than expected among explicitly measured background genes. The local engine computes exact hypergeometric upper-tail probabilities, expected overlaps, enrichment ratios, and BH-adjusted P-values across every eligible GMT gene set.</p>
    </header>
    <PathwayWorkbench />
    <p className={styles.footnote}>You provide the gene identifiers, measured universe, and GMT annotations. Results are conditional on these inputs and cannot establish causality. This lab does not fetch proprietary pathway collections or infer a correct background from thin air.</p>
  </main>;
}
