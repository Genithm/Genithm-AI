import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pretty(value: unknown) {
  return JSON.stringify(value ?? {}, null, 2);
}

export default async function ScientificJobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (!claimsData?.claims?.sub) redirect("/login");

  const [{ data: job, error }, { data: inputs }] = await Promise.all([
    supabase.from("scientific_jobs")
      .select("id,project_id,organization_id,job_type,tool_id,tool_version,status,parameters,processing_attempts,executor_version,result_object_path,result_sha256,result_bytes,result_summary,provenance,failure_class,processing_error,processing_started_at,processing_finished_at,created_at")
      .eq("id", id)
      .maybeSingle(),
    supabase.from("scientific_job_inputs")
      .select("input_position,input_role,sequence_upload_id,input_sha256,sequence_type,residue_count")
      .eq("job_id", id)
      .order("input_position", { ascending: true }),
  ]);

  if (error || !job) notFound();
  const summary = isRecord(job.result_summary) ? job.result_summary : {};
  const title = job.job_type === "multiple_sequence_alignment" ? "Multiple Sequence Alignment" : "Pairwise Alignment";

  return (
    <main className="container dashboard">
      <header className="dashboard-header">
        <div><div className="eyebrow">Scientific result</div><h2>{title}</h2><p className="small">Job {job.id}</p></div>
        <Link className="button" href="/dashboard">Back to dashboard</Link>
      </header>

      <section className="card">
        <div className="dashboard-header">
          <div><strong>{job.status.replaceAll("_", " ")}</strong><div className="small">Tool {job.tool_id}/{job.tool_version}{job.executor_version ? ` · executor ${job.executor_version}` : ""}</div></div>
          {job.status === "completed" && job.result_object_path ? <a className="button primary" href={`/dashboard/scientific-jobs/${job.id}/download`}>Download result</a> : null}
        </div>
        <div className="small">Created {new Date(job.created_at).toLocaleString()}{job.processing_started_at ? ` · started ${new Date(job.processing_started_at).toLocaleString()}` : ""}{job.processing_finished_at ? ` · finished ${new Date(job.processing_finished_at).toLocaleString()}` : ""}</div>
        <div className="small">Attempts: {job.processing_attempts}</div>
        {job.result_sha256 ? <div className="small">Result SHA-256: <code>{job.result_sha256}</code>{job.result_bytes ? ` · ${job.result_bytes} bytes` : ""}</div> : null}
        {job.processing_error ? <div className="error">{job.failure_class ? `${job.failure_class.replaceAll("_", " ")}: ` : ""}{job.processing_error}</div> : null}
      </section>

      <div className="section-grid" style={{ marginTop: 18 }}>
        <section className="card">
          <div className="eyebrow">Normalized result</div><h3>Summary</h3>
          {job.job_type === "pairwise_alignment" && job.status === "completed" ? <div className="list">
            <div className="item"><strong>Score</strong><div>{String(summary.score ?? "n/a")}</div></div>
            <div className="item"><strong>Identity</strong><div>{String(summary.identity_percent ?? "n/a")}%</div></div>
            <div className="item"><strong>Aligned length</strong><div>{String(summary.aligned_length ?? "n/a")}</div></div>
            <div className="item"><strong>Matches / mismatches / gaps</strong><div>{String(summary.matches ?? "n/a")} / {String(summary.mismatches ?? "n/a")} / {String(summary.gaps ?? "n/a")}</div></div>
          </div> : null}
          {job.job_type === "multiple_sequence_alignment" && job.status === "completed" ? <div className="list">
            <div className="item"><strong>Sequences</strong><div>{String(summary.sequence_count ?? "n/a")}</div></div>
            <div className="item"><strong>Aligned length</strong><div>{String(summary.aligned_length ?? "n/a")}</div></div>
            <div className="item"><strong>Strategy</strong><div>{String(summary.strategy ?? "n/a")}</div></div>
          </div> : null}
          {job.status !== "completed" ? <div className="notice">The result summary becomes available after the isolated scientific worker completes this job.</div> : null}
        </section>

        <section className="card">
          <div className="eyebrow">Inputs</div><h3>Immutable input references</h3>
          <div className="list">{(inputs ?? []).map((input) => <div className="item" key={`${input.input_position}-${input.sequence_upload_id}`}>
            <strong>#{input.input_position} · {input.input_role}</strong>
            <div className="small">{input.sequence_type} · {input.residue_count} residues/bases</div>
            <div className="small">SHA-256 <code>{input.input_sha256}</code></div>
          </div>)}</div>
        </section>
      </div>

      <section className="card" style={{ marginTop: 18 }}>
        <div className="eyebrow">Reproducibility</div><h3>Parameters</h3>
        <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{pretty(job.parameters)}</pre>
      </section>
      <section className="card" style={{ marginTop: 18 }}>
        <div className="eyebrow">Evidence trail</div><h3>Provenance</h3>
        <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{pretty(job.provenance)}</pre>
      </section>
    </main>
  );
}
