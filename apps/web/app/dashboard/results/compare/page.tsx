import Link from "next/link";
import { redirect } from "next/navigation";

import { VerifiedComparisonViewer } from "@/components/verified-comparison-viewer";
import { createClient } from "@/lib/supabase/server";
import { parseComparisonIds, type ComparableJobType } from "@/lib/verified-scientific-comparison";
import styles from "./compare.module.css";

export const dynamic = "force-dynamic";

export default async function CompareScientificResults({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string }>;
}) {
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (authError || !userId) redirect("/login");

  const { ids: rawIds } = await searchParams;
  const ids = parseComparisonIds(rawIds);
  if (!ids) {
    return (
      <main className={styles.shell}>
        <Link href="/dashboard/results" className={styles.back}>← Scientific results</Link>
        <h1>Compare scientific analyses</h1>
        <p role="alert" className={styles.error}>Select two to four distinct scientific job IDs from the results center.</p>
        <Link href="/dashboard/results" className={styles.action}>Choose results</Link>
      </main>
    );
  }

  const { data, error } = await supabase
    .from("scientific_jobs")
    .select("id,job_type,status,project_id,tool_version,result_sha256,created_at")
    .eq("requested_by", userId)
    .in("id", ids);

  const indexed = new Map((data ?? []).map(job => [job.id.toLowerCase(), job]));
  const ordered = ids.map(id => indexed.get(id.toLowerCase()));
  const jobType = ordered[0]?.job_type;
  const valid = !error && ordered.length === ids.length &&
    ordered.every(job =>
      job && job.job_type === jobType && job.status === "completed" &&
      typeof job.result_sha256 === "string" && /^[0-9a-f]{64}$/.test(job.result_sha256) &&
      typeof job.tool_version === "string") &&
    (jobType === "protein_properties" || jobType === "pairwise_alignment");

  if (!valid) {
    // Unavailable, unauthorized and mismatched job IDs use the same response.
    // Do not display even a partial result if the selected set cannot be verified.
    return (
      <main className={styles.shell}>
        <Link href="/dashboard/results" className={styles.back}>← Scientific results</Link>
        <h1>Compare scientific analyses</h1>
        <p role="alert" className={styles.error}>
          This selection cannot be compared. Choose two to four completed,
          accessible analyses of the same supported type with recorded result fingerprints.
        </p>
        <Link href="/dashboard/results" className={styles.action}>Choose another selection</Link>
      </main>
    );
  }

  const jobs = ordered.map(job => ({
    id: job!.id,
    jobType: jobType as ComparableJobType,
    sha256: job!.result_sha256 as string,
    toolVersion: job!.tool_version,
  }));

  return (
    <main className={styles.shell} aria-label="Verified scientific result comparison">
      <nav className={styles.navigation}>
        <Link href="/dashboard/results" className={styles.back}>← Scientific results</Link>
        <Link href="/dashboard/ai">Genithm chat</Link>
      </nav>
      <header className={styles.hero}>
        <div className={styles.eyebrow}>GENITHM / VERIFIED SCIENTIFIC ANALYSIS</div>
        <h1>Compare your results</h1>
        <p>Explore differences between completed scientific runs. Numerical comparisons are displayed
          only after every source artifact has passed the existing server-side SHA-256 and format checks.</p>
      </header>
      <VerifiedComparisonViewer jobs={jobs} />
    </main>
  );
}
