import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { reportJobTitle } from "@/lib/scientific-report";

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error: queryError } = await searchParams;
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (!claimsData?.claims?.sub) redirect("/login");

  const { data: reports, error } = await supabase
    .from("scientific_reports")
    .select("id,project_id,source_job_id,source_job_type,source_result_sha256,report_schema_version,report_sha256,generated_at")
    .order("generated_at", { ascending: false })
    .limit(100);

  return (
    <main className="container dashboard">
      <header className="dashboard-header">
        <div>
          <div className="eyebrow">Reproducibility</div>
          <h2>Scientific reports</h2>
          <p className="small">Immutable, hash-sealed snapshots generated from completed authoritative scientific jobs.</p>
        </div>
        <Link className="button" href="/dashboard">Back to dashboard</Link>
      </header>

      {queryError ? <div className="error">{queryError}</div> : null}
      {error ? <div className="error">Reports could not be loaded.</div> : null}

      <section className="card">
        <div className="eyebrow">Report policy</div>
        <h3>Scientific truth stays separate from AI interpretation</h3>
        <p className="small">V1 reports contain recorded tool results, parameters, inputs, workflow lineage and provenance. AI interpretations and follow-up answers are deliberately excluded from the sealed scientific snapshot.</p>
      </section>

      <section className="card" style={{ marginTop: 18 }}>
        <div className="eyebrow">Your reports</div>
        <h3>Generated snapshots</h3>
        {(reports ?? []).length ? (
          <div className="list">
            {(reports ?? []).map((report) => (
              <div className="item" key={report.id}>
                <strong>{reportJobTitle(report.source_job_type)}</strong>
                <div className="small">Generated {new Date(report.generated_at).toLocaleString()}</div>
                <div className="small">Report SHA-256 <code>{report.report_sha256}</code></div>
                <div className="small">Source SHA-256 <code>{report.source_result_sha256}</code></div>
                <div className="actions" style={{ marginTop: 10 }}>
                  <Link className="button primary" href={`/dashboard/reports/${report.id}`}>Open report</Link>
                  <Link className="button" href={`/dashboard/scientific-jobs/${report.source_job_id}`}>Source job</Link>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="notice">No reports yet. Open a completed scientific job and generate its sealed report.</div>
        )}
      </section>
    </main>
  );
}
