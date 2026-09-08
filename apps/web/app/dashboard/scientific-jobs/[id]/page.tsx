import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { requestScientificReport } from "@/app/dashboard/report-actions";
import { createClient } from "@/lib/supabase/server";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pretty(value: unknown) {
  return JSON.stringify(value ?? {}, null, 2);
}

function jobTitle(jobType: string) {
  if (jobType === "multiple_sequence_alignment") return "Multiple Sequence Alignment";
  if (jobType === "phylogenetic_tree") return "Phylogenetic Tree";
  if (jobType === "protein_properties") return "Protein Properties";
  return "Pairwise Alignment";
}

function proteinComposition(value: unknown): Array<[string, number]> {
  if (!isRecord(value)) return [];
  return Object.entries(value)
    .filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1]))
    .sort(([left], [right]) => left.localeCompare(right));
}

export default async function ScientificJobPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error: queryError } = await searchParams;
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (!claimsData?.claims?.sub) redirect("/login");

  const [{ data: job, error }, { data: inputs }, { data: dependencies }, { data: existingReport }] = await Promise.all([
    supabase.from("scientific_jobs")
      .select("id,project_id,organization_id,job_type,tool_id,tool_version,status,parameters,processing_attempts,executor_version,result_object_path,result_sha256,result_bytes,result_summary,provenance,failure_class,processing_error,processing_started_at,processing_finished_at,created_at")
      .eq("id", id)
      .maybeSingle(),
    supabase.from("scientific_job_inputs")
      .select("input_position,input_role,sequence_upload_id,input_sha256,sequence_type,residue_count")
      .eq("job_id", id)
      .order("input_position", { ascending: true }),
    supabase.from("scientific_job_dependencies")
      .select("dependency_job_id,dependency_role,dependency_result_sha256,created_at")
      .eq("job_id", id)
      .order("created_at", { ascending: true }),
    supabase.from("scientific_reports")
      .select("id,report_sha256,generated_at")
      .eq("source_job_id", id)
      .maybeSingle(),
  ]);

  if (error || !job) notFound();
  const summary = isRecord(job.result_summary) ? job.result_summary : {};
  const title = jobTitle(job.job_type);
  const composition = proteinComposition(summary.amino_acid_composition);

  return (
    <main className="container dashboard">
      <header className="dashboard-header">
        <div><div className="eyebrow">Scientific result</div><h2>{title}</h2><p className="small">Job {job.id}</p></div>
        <div className="actions">
          {existingReport ? <Link className="button primary" href={`/dashboard/reports/${existingReport.id}`}>Open report</Link> : null}
          {job.status === "completed" && job.result_sha256 && !existingReport ? (
            <form action={requestScientificReport}>
              <input type="hidden" name="source_job_id" value={job.id} />
              <button className="button primary" type="submit">Generate report</button>
            </form>
          ) : null}
          <Link className="button" href="/dashboard">Back to dashboard</Link>
        </div>
      </header>

      {queryError ? <div className="error">{queryError}</div> : null}

      <section className="card">
        <div className="dashboard-header">
          <div><strong>{job.status.replaceAll("_", " ")}</strong><div className="small">Tool {job.tool_id}/{job.tool_version}{job.executor_version ? ` · executor ${job.executor_version}` : ""}</div></div>
          {job.status === "completed" && job.result_object_path ? <a className="button" href={`/dashboard/scientific-jobs/${job.id}/download`}>Download raw result</a> : null}
        </div>
        <div className="small">Created {new Date(job.created_at).toLocaleString()}{job.processing_started_at ? ` · started ${new Date(job.processing_started_at).toLocaleString()}` : ""}{job.processing_finished_at ? ` · finished ${new Date(job.processing_finished_at).toLocaleString()}` : ""}</div>
        <div className="small">Attempts: {job.processing_attempts}</div>
        {job.result_sha256 ? <div className="small">Result SHA-256: <code>{job.result_sha256}</code>{job.result_bytes ? ` · ${job.result_bytes} bytes` : ""}</div> : null}
        {existingReport ? <div className="small">Report SHA-256: <code>{existingReport.report_sha256}</code> · generated {new Date(existingReport.generated_at).toLocaleString()}</div> : null}
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
          {job.job_type === "phylogenetic_tree" && job.status === "completed" ? <div className="list">
            <div className="item"><strong>Model</strong><div>{String(summary.model ?? "n/a")}</div></div>
            <div className="item"><strong>Leaves</strong><div>{String(summary.leaf_count ?? "n/a")}</div></div>
            <div className="item"><strong>Support-labelled internal nodes</strong><div>{String(summary.internal_support_count ?? "n/a")}</div></div>
            <div className="item"><strong>Source MSA SHA-256</strong><div><code>{String(summary.source_msa_sha256 ?? "n/a")}</code></div></div>
          </div> : null}
          {job.job_type === "protein_properties" && job.status === "completed" ? <div className="list">
            <div className="item"><strong>Length</strong><div>{String(summary.length ?? "n/a")} amino acids</div></div>
            <div className="item"><strong>Average molecular weight</strong><div>{String(summary.molecular_weight_da ?? "n/a")} Da</div></div>
            <div className="item"><strong>Aromaticity</strong><div>{typeof summary.aromaticity_fraction === "number" ? `${(summary.aromaticity_fraction * 100).toFixed(3)}%` : "n/a"}</div></div>
            <div className="item"><strong>GRAVY</strong><div>{String(summary.gravy ?? "n/a")}</div></div>
            <div className="item"><strong>Estimated net charge at pH 7</strong><div>{String(summary.estimated_net_charge_ph7 ?? "n/a")}</div></div>
            <div className="item"><strong>Estimated isoelectric point</strong><div>{String(summary.estimated_isoelectric_point ?? "n/a")}</div></div>
          </div> : null}
          {job.status !== "completed" ? <div className="notice">The result summary becomes available after the isolated scientific worker completes this job.</div> : null}
        </section>

        <section className="card">
          <div className="eyebrow">Inputs</div><h3>Immutable input references</h3>
          {(inputs ?? []).length ? <div className="list">{(inputs ?? []).map((input) => <div className="item" key={`${input.input_position}-${input.sequence_upload_id}`}>
            <strong>#{input.input_position} · {input.input_role}</strong>
            <div className="small">{input.sequence_type} · {input.residue_count} residues/bases</div>
            <div className="small">SHA-256 <code>{input.input_sha256}</code></div>
          </div>)}</div> : <div className="notice">This job derives from a prior scientific result rather than a raw sequence upload.</div>}
        </section>
      </div>

      {job.job_type === "protein_properties" && job.status === "completed" ? <section className="card" style={{ marginTop: 18 }}>
        <div className="eyebrow">Protein composition</div><h3>Amino-acid counts</h3>
        {composition.length ? <div className="list">{composition.map(([aminoAcid, count]) => <div className="item" key={aminoAcid}><strong>{aminoAcid}</strong><div>{count}</div></div>)}</div> : <div className="notice">Amino-acid composition was not available in the normalized result.</div>}
        <div className="notice" style={{ marginTop: 18 }}>
          Charge and isoelectric point are deterministic estimates under the recorded V1 pKa model. This calculation does not model post-translational modifications, disulfide state, cofactors, terminal modifications, domains, motifs, structure, or biological function.
        </div>
      </section> : null}

      {(dependencies ?? []).length ? <section className="card" style={{ marginTop: 18 }}>
        <div className="eyebrow">Workflow lineage</div><h3>Scientific job dependencies</h3>
        <div className="list">{(dependencies ?? []).map((dependency) => <div className="item" key={`${dependency.dependency_job_id}-${dependency.dependency_role}`}>
          <strong>{dependency.dependency_role.replaceAll("_", " ")}</strong>
          <div className="small">Result SHA-256 <code>{dependency.dependency_result_sha256}</code></div>
          <Link className="button" href={`/dashboard/scientific-jobs/${dependency.dependency_job_id}`}>Open source job</Link>
        </div>)}</div>
      </section> : null}

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
