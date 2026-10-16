import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { VerifiedComparisonViewer } from "@/components/verified-comparison-viewer";
import { createClient } from "@/lib/supabase/server";
import type { ComparableJobType } from "@/lib/verified-scientific-comparison";
import { deleteScientificComparisonStudy, updateScientificComparisonStudy } from "../actions";
import styles from "../studies.module.css";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

export default async function SavedScientificStudyDetail({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; updated?: string }>;
}) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId || authError) redirect("/login");

  const { data: study, error } = await supabase.from("scientific_comparison_studies")
    .select("id,created_by,project_id,title,description,job_type,job_ids,source_sha256,tool_versions,created_at,updated_at")
    .eq("id",id).eq("created_by",userId).maybeSingle();
  if (error || !study) notFound();

  const ids = study.job_ids;
  const metadataAligned = ids.length>=2 && ids.length<=4 &&
    new Set(ids.map(s=>s.toLowerCase())).size===ids.length &&
    study.source_sha256.length===ids.length && study.tool_versions.length===ids.length &&
    ["protein_properties","pairwise_alignment"].includes(study.job_type);

  const { data: sourceJobs, error: jobError } = metadataAligned
    ? await supabase.from("scientific_jobs")
      .select("id,project_id,requested_by,job_type,status,result_sha256,tool_version")
      .eq("requested_by",userId).in("id",ids)
    : { data: null, error: null };
  const byId = new Map((sourceJobs ?? []).map(job=>[job.id.toLowerCase(),job]));
  const ordered = ids.map(jobId=>byId.get(jobId.toLowerCase()));
  const safe = metadataAligned && !jobError && (sourceJobs ?? []).length===ids.length &&
    ordered.every((job,i)=> Boolean(job &&
      job.requested_by===userId && job.project_id===study.project_id &&
      job.job_type===study.job_type && job.status==="completed" &&
      job.result_sha256===study.source_sha256[i] &&
      job.tool_version===study.tool_versions[i]));

  const jobs = safe ? ids.map((jobId,i)=>({
    id:jobId,
    jobType:study.job_type as ComparableJobType,
    sha256:study.source_sha256[i],
    toolVersion:study.tool_versions[i],
  })) : [];

  const status = await searchParams;
  return (
    <main className={styles.shell}>
      <nav className={styles.navigation} aria-label="Saved study navigation">
        <Link href="/dashboard/results/studies">← Saved studies</Link>
        <Link href="/dashboard/results">Scientific results</Link>
        <Link href="/dashboard/notebook">Research notebook</Link>
      </nav>
      <header className={styles.hero}>
        <span className={styles.kicker}>GENITHM · PERSISTED COMPARISON STUDY</span>
        <h1>{study.title}</h1>
        <p>{study.description || "Reopen this saved research comparison against its original scientific evidence."}</p>
        <span className={styles.heroSmall}>Saved {new Date(study.created_at).toLocaleString("en",{timeZone:"UTC"})} UTC · {ids.length} source runs</span>
      </header>
      {status.saved || status.updated ? <p role="status" className={styles.success}>{status.saved ? "Study saved.": "Study details updated."} Source selections remain immutable.</p> : null}
      {safe ? <VerifiedComparisonViewer jobs={jobs} allowSave={false}/> :
        <section className={styles.warning} role="alert">
          <h2>Stored evidence is no longer consistent</h2>
          <p>One or more completed jobs are missing, inaccessible, changed, or do not match the saved SHA-256 or tool version. Genithm has withheld the comparison. The saved research record remains available for review.</p>
        </section>}
      <section className={styles.editPanel}>
        <h2>Study details</h2>
        <p>Titles and research context are editable. Sources, their order, hashes, and tool versions cannot be changed after saving.</p>
        <form action={updateScientificComparisonStudy} className={styles.editForm}>
          <input type="hidden" name="study_id" value={study.id}/>
          <label>Title<input name="title" defaultValue={study.title} maxLength={160} minLength={3} required/></label>
          <label>Research context<textarea name="description" defaultValue={study.description} maxLength={2000} rows={4}/></label>
          <button type="submit">Save study details</button>
        </form>
        <details className={styles.danger}>
          <summary>Delete this saved study</summary>
          <p>This removes only the saved comparison record, never the underlying scientific jobs or reports.</p>
          <form action={deleteScientificComparisonStudy}>
            <input type="hidden" name="study_id" value={study.id}/>
            <button type="submit">Delete saved study</button>
          </form>
        </details>
      </section>
      <p className={styles.disclaimer}>Every re-open retrieves verified scientific result projections from the existing authenticated analysis endpoint. No historical chart values are treated as independent experimental findings.</p>
    </main>
  );
}
