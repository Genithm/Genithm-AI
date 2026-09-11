import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { requestScientificReport } from "@/app/dashboard/report-actions";
import { createClient } from "@/lib/supabase/server";
import { ScientificJobStatus } from "./scientific-job-status";
import styles from "./scientific-job.module.css";

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

function metric(label: string, value: string) {
  return (
    <div className={styles.metric}>
      <div className={styles.metricLabel}>{label}</div>
      <div className={styles.metricValue}>{value}</div>
    </div>
  );
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
  const completed = job.status === "completed";
  const failed = job.status === "failed";

  return (
    <main className="container dashboard">
      <section className={styles.resultHero}>
        <div>
          <div className="eyebrow">Scientific result</div>
          <h1>{title}</h1>
          <div className={styles.jobId}>Job {job.id}</div>
          <p>Validated scientific execution with immutable inputs, tool versioning, result hashes, and provenance preserved for reproducibility.</p>
        </div>
        <div className="actions">
          {existingReport ? <Link className="button primary" href={`/dashboard/reports/${existingReport.id}`}>Open report</Link> : null}
          {completed && job.result_sha256 && !existingReport ? (
            <form action={requestScientificReport}>
              <input type="hidden" name="source_job_id" value={job.id} />
              <button className="button primary" type="submit">Generate report</button>
            </form>
          ) : null}
          {completed && job.result_object_path ? <a className="button" href={`/dashboard/scientific-jobs/${job.id}/download`}>Download raw result</a> : null}
          <Link className="button" href="/dashboard">Back to dashboard</Link>
        </div>
      </section>

      {queryError ? <div className="error">{queryError}</div> : null}

      <section className="card">
        <div className="eyebrow">Execution state</div>
        <h2>Job progress</h2>
        <ScientificJobStatus
          status={job.status}
          createdAt={job.created_at}
          startedAt={job.processing_started_at}
          finishedAt={job.processing_finished_at}
          attempts={job.processing_attempts}
        />
        <div className="small" style={{ marginTop: 14 }}>
          Tool {job.tool_id}/{job.tool_version}{job.executor_version ? ` · executor ${job.executor_version}` : ""}
        </div>
        {failed && job.processing_error ? (
          <div className={styles.failurePanel} style={{ marginTop: 16 }}>
            <strong>{job.failure_class ? job.failure_class.replaceAll("_", " ") : "Scientific job failed"}</strong>
            <p>{job.processing_error}</p>
          </div>
        ) : null}
      </section>

      <div className="section-grid">
        <section className="card">
          <div className="eyebrow">Normalized result</div>
          <h2>Key findings</h2>

          {job.job_type === "pairwise_alignment" && completed ? (
            <div className={styles.metricGrid}>
              {metric("Score", String(summary.score ?? "n/a"))}
              {metric("Identity", `${String(summary.identity_percent ?? "n/a")}%`)}
              {metric("Aligned length", String(summary.aligned_length ?? "n/a"))}
              {metric("Matches / mismatches / gaps", `${String(summary.matches ?? "n/a")} / ${String(summary.mismatches ?? "n/a")} / ${String(summary.gaps ?? "n/a")}`)}
            </div>
          ) : null}

          {job.job_type === "multiple_sequence_alignment" && completed ? (
            <div className={styles.metricGrid}>
              {metric("Sequences", String(summary.sequence_count ?? "n/a"))}
              {metric("Aligned length", String(summary.aligned_length ?? "n/a"))}
              {metric("Strategy", String(summary.strategy ?? "n/a"))}
            </div>
          ) : null}

          {job.job_type === "phylogenetic_tree" && completed ? (
            <div className={styles.metricGrid}>
              {metric("Model", String(summary.model ?? "n/a"))}
              {metric("Leaves", String(summary.leaf_count ?? "n/a"))}
              {metric("Supported internal nodes", String(summary.internal_support_count ?? "n/a"))}
              {metric("Source MSA hash", String(summary.source_msa_sha256 ?? "n/a"))}
            </div>
          ) : null}

          {job.job_type === "protein_properties" && completed ? (
            <div className={styles.metricGrid}>
              {metric("Length", `${String(summary.length ?? "n/a")} aa`)}
              {metric("Molecular weight", `${String(summary.molecular_weight_da ?? "n/a")} Da`)}
              {metric("Aromaticity", typeof summary.aromaticity_fraction === "number" ? `${(summary.aromaticity_fraction * 100).toFixed(3)}%` : "n/a")}
              {metric("GRAVY", String(summary.gravy ?? "n/a"))}
              {metric("Net charge at pH 7", String(summary.estimated_net_charge_ph7 ?? "n/a"))}
              {metric("Estimated pI", String(summary.estimated_isoelectric_point ?? "n/a"))}
            </div>
          ) : null}

          {!completed && !failed ? <div className="notice">Results will appear here automatically after the isolated scientific worker finishes and the output passes validation.</div> : null}
          {failed ? <div className="notice">No scientific result is presented because this execution did not complete successfully.</div> : null}
        </section>

        <section className="card">
          <div className="eyebrow">Integrity</div>
          <h2>Reproducibility record</h2>
          <div className="list">
            <div className="item"><strong>Tool</strong><div className="small">{job.tool_id}/{job.tool_version}{job.executor_version ? ` · executor ${job.executor_version}` : ""}</div></div>
            <div className="item"><strong>Attempts</strong><div className="small">{job.processing_attempts}</div></div>
            {job.result_sha256 ? <div className="item"><strong>Result SHA-256</strong><div className={`small ${styles.hash}`}><code>{job.result_sha256}</code></div></div> : null}
            {job.result_bytes ? <div className="item"><strong>Result size</strong><div className="small">{job.result_bytes} bytes</div></div> : null}
            {existingReport ? <div className="item"><strong>Report SHA-256</strong><div className={`small ${styles.hash}`}><code>{existingReport.report_sha256}</code></div><div className="small">Generated {new Date(existingReport.generated_at).toLocaleString()}</div></div> : null}
          </div>
        </section>
      </div>

      <section className="card">
        <div className="eyebrow">Inputs</div>
        <h2>Immutable input references</h2>
        {(inputs ?? []).length ? <div className="list">{(inputs ?? []).map((input) => <div className="item" key={`${input.input_position}-${input.sequence_upload_id}`}>
          <strong>#{input.input_position} · {input.input_role}</strong>
          <div className="small">{input.sequence_type} · {input.residue_count} residues/bases</div>
          <div className={`small ${styles.hash}`}>SHA-256 <code>{input.input_sha256}</code></div>
        </div>)}</div> : <div className="notice">This job derives from a prior scientific result rather than a raw sequence upload.</div>}
      </section>

      {job.job_type === "protein_properties" && completed ? <section className="card">
        <div className="eyebrow">Protein composition</div>
        <h2>Amino-acid counts</h2>
        {composition.length ? <div className={styles.metricGrid}>{composition.map(([aminoAcid, count]) => metric(aminoAcid, String(count)))}</div> : <div className="notice">Amino-acid composition was not available in the normalized result.</div>}
        <div className="notice" style={{ marginTop: 18 }}>
          Charge and isoelectric point are deterministic estimates under the recorded V1 pKa model. This calculation does not model post-translational modifications, disulfide state, cofactors, terminal modifications, domains, motifs, structure, or biological function.
        </div>
      </section> : null}

      {(dependencies ?? []).length ? <section className="card">
        <div className="eyebrow">Workflow lineage</div>
        <h2>Scientific job dependencies</h2>
        <div className="list">{(dependencies ?? []).map((dependency) => <div className="item" key={`${dependency.dependency_job_id}-${dependency.dependency_role}`}>
          <strong>{dependency.dependency_role.replaceAll("_", " ")}</strong>
          <div className={`small ${styles.hash}`}>Result SHA-256 <code>{dependency.dependency_result_sha256}</code></div>
          <div className="actions"><Link className="button compact" href={`/dashboard/scientific-jobs/${dependency.dependency_job_id}`}>Open source job</Link></div>
        </div>)}</div>
      </section> : null}

      <section className="card">
        <div className="eyebrow">Evidence trail</div>
        <h2>Parameters & provenance</h2>
        <p>Detailed machine-readable execution metadata is preserved below for reproducibility and audit, but collapsed by default to keep the primary scientific result readable.</p>
        <div className={styles.evidenceGrid}>
          <details className={styles.disclosure}>
            <summary>Execution parameters</summary>
            <pre className={styles.codeBlock}>{pretty(job.parameters)}</pre>
          </details>
          <details className={styles.disclosure}>
            <summary>Scientific provenance</summary>
            <pre className={styles.codeBlock}>{pretty(job.provenance)}</pre>
          </details>
        </div>
      </section>
    </main>
  );
}
