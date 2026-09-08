import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { asRecord, reportJobTitle } from "@/lib/scientific-report";

function pretty(value: unknown) {
  return JSON.stringify(value ?? {}, null, 2);
}

export default async function ScientificReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (!claimsData?.claims?.sub) redirect("/login");

  const { data, error } = await supabase.rpc("get_scientific_report", { report_id: id });
  const report = data?.[0];
  if (error || !report) notFound();

  const snapshot = asRecord(report.report_snapshot);
  const project = asRecord(snapshot.project);
  const source = asRecord(snapshot.source);
  const tool = asRecord(snapshot.tool);
  const policy = asRecord(snapshot.interpretation_policy);

  return (
    <main className="container dashboard">
      <header className="dashboard-header">
        <div>
          <div className="eyebrow">Scientific report</div>
          <h2>{reportJobTitle(report.source_job_type)}</h2>
          <p className="small">Report {report.id}</p>
        </div>
        <div className="actions">
          <Link className="button" href="/dashboard/reports">All reports</Link>
          <Link className="button" href={`/dashboard/scientific-jobs/${report.source_job_id}`}>Source job</Link>
        </div>
      </header>

      {!report.integrity_valid ? (
        <section className="card">
          <div className="error"><strong>Integrity check failed.</strong> The stored snapshot no longer matches its recorded SHA-256. Trusted rendering and export are disabled.</div>
        </section>
      ) : (
        <>
          <section className="card">
            <div className="dashboard-header">
              <div>
                <div className="eyebrow">Integrity verified</div>
                <h3>Immutable report seal</h3>
              </div>
              <div className="actions">
                <a className="button primary" href={`/dashboard/reports/${report.id}/export/json`}>JSON</a>
                <a className="button" href={`/dashboard/reports/${report.id}/export/markdown`}>Markdown</a>
                <a className="button" href={`/dashboard/reports/${report.id}/export/html`}>HTML</a>
              </div>
            </div>
            <div className="small">Generated {new Date(report.generated_at).toLocaleString()} · schema {report.report_schema_version}</div>
            <div className="small">Report SHA-256: <code>{report.report_sha256}</code></div>
            <div className="small">Source result SHA-256: <code>{report.source_result_sha256}</code></div>
          </section>

          <div className="section-grid" style={{ marginTop: 18 }}>
            <section className="card">
              <div className="eyebrow">Context</div><h3>Project & source</h3>
              <div className="list">
                <div className="item"><strong>Project</strong><div>{String(project.name ?? "n/a")}</div><div className="small">{String(project.id ?? "")}</div></div>
                <div className="item"><strong>Source job</strong><div>{String(source.resource_id ?? report.source_job_id)}</div></div>
                <div className="item"><strong>Completed</strong><div>{String(source.completed_at ?? "n/a")}</div></div>
              </div>
            </section>
            <section className="card">
              <div className="eyebrow">Authoritative tool</div><h3>Execution</h3>
              <div className="list">
                <div className="item"><strong>Tool</strong><div>{String(tool.id ?? "n/a")} / {String(tool.version ?? "n/a")}</div></div>
                <div className="item"><strong>Executor</strong><div>{String(tool.executor_version ?? "n/a")}</div></div>
              </div>
            </section>
          </div>

          <section className="card" style={{ marginTop: 18 }}>
            <div className="eyebrow">Authoritative result</div><h3>Normalized summary</h3>
            <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{pretty(snapshot.result_summary)}</pre>
          </section>
          <section className="card" style={{ marginTop: 18 }}>
            <div className="eyebrow">Reproducibility</div><h3>Parameters</h3>
            <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{pretty(snapshot.parameters)}</pre>
          </section>
          <section className="card" style={{ marginTop: 18 }}>
            <div className="eyebrow">Inputs & lineage</div><h3>Immutable references</h3>
            <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{pretty({ inputs: snapshot.inputs, dependencies: snapshot.dependencies })}</pre>
          </section>
          <section className="card" style={{ marginTop: 18 }}>
            <div className="eyebrow">Evidence trail</div><h3>Provenance</h3>
            <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{pretty(snapshot.provenance)}</pre>
          </section>
          <section className="card" style={{ marginTop: 18 }}>
            <div className="eyebrow">Interpretation boundary</div><h3>Scientific truth policy</h3>
            <div className="notice">{String(policy.statement ?? "AI interpretation is not included in this report snapshot.")}</div>
          </section>
        </>
      )}
    </main>
  );
}
