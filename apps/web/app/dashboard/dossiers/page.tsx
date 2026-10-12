import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { DossierBuilder } from "./dossier-builder";
import styles from "./dossiers.module.css";

export const dynamic = "force-dynamic";

export default async function DossiersPage() {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (!claimsData?.claims?.sub) redirect("/login");

  const [projectsResult, reportsResult] = await Promise.all([
    supabase.from("projects")
      .select("id,name")
      .order("name", { ascending: true })
      .limit(100),
    supabase.from("scientific_reports")
      .select("id,project_id,source_resource_type,source_job_type,report_sha256,generated_at")
      .order("generated_at", { ascending: false })
      .limit(200),
  ]);
  return (
    <main className={"container dashboard " + styles.screen}>
      <header className={styles.hero}>
        <div>
          <div className={styles.eyebrow}>Verified research evidence</div>
          <h1>Build a research dossier.</h1>
          <p>Select multiple sealed scientific reports, review source-specific measurements and export one reproducible, independently checkable research evidence package.</p>
        </div>
        <Link className="button" href="/dashboard/reports">Manage reports</Link>
      </header>
      {projectsResult.error || reportsResult.error ? (
        <div className="error" role="alert">
          Some authorized research records could not be loaded. Dossier creation is unavailable until the snapshot is complete.
        </div>
      ) : (
        <DossierBuilder
          projects={(projectsResult.data ?? []).map(p => ({ id: p.id, name: p.name }))}
          reports={(reportsResult.data ?? []).map(r => ({
            id: r.id, projectId: r.project_id, sourceType: r.source_resource_type,
            subtype: r.source_job_type, seal: r.report_sha256, generatedAt: r.generated_at,
          }))}
        />
      )}
      <div className={styles.policy}>
        <strong>Research integrity:</strong> Only owner-accessible, finalized, database-sealed reports can enter a dossier. Report snapshots are checked again before comparison or download. This process does not rerun scientific tools, refresh NCBI/BLAST data or generate unsupported AI interpretations.
      </div>
    </main>
  );
}
