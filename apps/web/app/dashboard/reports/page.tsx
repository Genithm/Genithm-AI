import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { reportSourcePath, reportSourceTitle } from "@/lib/scientific-report";
import { requestAuthoritativeReport } from "../report-actions";

function reportForm(resourceType: string, resourceId: string) {
  return (
    <form action={requestAuthoritativeReport}>
      <input type="hidden" name="source_resource_type" value={resourceType} />
      <input type="hidden" name="source_resource_id" value={resourceId} />
      <button className="button primary">Generate sealed report</button>
    </form>
  );
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error: queryError } = await searchParams;
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (!claimsData?.claims?.sub) redirect("/login");

  const [reportsResult, blastResult, retrievalResult, annotationResult] = await Promise.all([
    supabase.from("scientific_reports")
      .select("id,project_id,source_job_id,source_job_type,source_result_sha256,source_resource_type,source_resource_id,source_evidence_sha256,report_schema_version,report_sha256,generated_at")
      .order("generated_at", { ascending: false }).limit(100),
    supabase.from("blast_jobs")
      .select("id,program,database_name,status,raw_result_sha256,processing_finished_at,created_at")
      .eq("status", "completed").not("raw_result_sha256", "is", null)
      .order("created_at", { ascending: false }).limit(30),
    supabase.from("sequence_retrievals")
      .select("id,source_database,requested_accession,resolved_accession,status,source_checked_at,source_response_sha256,result_message,created_at")
      .in("status", ["retrieved", "not_found"]).not("source_checked_at", "is", null)
      .order("created_at", { ascending: false }).limit(30),
    supabase.from("protein_annotation_jobs")
      .select("id,refseq_accession,status,protein_name,uniprot_accession,source_checked_at,created_at")
      .in("status", ["completed", "no_mapping"]).not("source_checked_at", "is", null)
      .order("created_at", { ascending: false }).limit(30),
  ]);

  const reports = reportsResult.data ?? [];
  const reportKeys = new Set(reports.map((report) => `${report.source_resource_type}:${report.source_resource_id}`));

  return (
    <main className="container dashboard">
      <header className="dashboard-header">
        <div>
          <div className="eyebrow">Reproducibility</div>
          <h2>Scientific reports</h2>
          <p className="small">Immutable, hash-sealed snapshots generated from finalized authoritative scientific evidence.</p>
        </div>
        <Link className="button" href="/dashboard">Back to dashboard</Link>
      </header>

      {queryError ? <div className="error">{queryError}</div> : null}
      {reportsResult.error ? <div className="error">Reports could not be loaded.</div> : null}

      <section className="card">
        <div className="eyebrow">Report policy</div>
        <h3>Scientific truth stays separate from AI interpretation</h3>
        <p className="small">Reports contain recorded tool/source results, parameters, immutable input references and provenance. AI interpretations and follow-up answers remain outside the sealed scientific truth snapshot.</p>
      </section>

      <section className="card" style={{ marginTop: 18 }}>
        <div className="eyebrow">Your reports</div>
        <h3>Generated snapshots</h3>
        {reports.length ? <div className="list">{reports.map((report) => {
          const sourceType = report.source_resource_type || "scientific_job";
          const subtype = report.source_job_type;
          return <div className="item" key={report.id}>
            <strong>{reportSourceTitle(sourceType, subtype)}</strong>
            <div className="small">Generated {new Date(report.generated_at).toLocaleString()} · schema {report.report_schema_version}</div>
            <div className="small">Report SHA-256 <code>{report.report_sha256}</code></div>
            <div className="small">Source evidence SHA-256 <code>{report.source_evidence_sha256 ?? report.source_result_sha256 ?? "n/a"}</code></div>
            <div className="actions" style={{ marginTop: 10 }}>
              <Link className="button primary" href={`/dashboard/reports/${report.id}`}>Open report</Link>
              <Link className="button" href={reportSourcePath(sourceType, report.source_resource_id)}>Source evidence</Link>
            </div>
          </div>;
        })}</div> : <div className="notice">No reports yet. Finalize authoritative evidence below and generate its sealed report.</div>}
      </section>

      <section className="card" style={{ marginTop: 18 }}>
        <div className="eyebrow">BLAST</div><h3>Finalized similarity-search evidence</h3>
        {blastResult.error ? <div className="error">BLAST report sources could not be loaded.</div> : null}
        <div className="list">{(blastResult.data ?? []).map((job) => {
          const exists = reportKeys.has(`blast_job:${job.id}`);
          return <div className="item" key={job.id}>
            <strong>{job.program.toUpperCase()} · {job.database_name}</strong>
            <div className="small">Completed {job.processing_finished_at ? new Date(job.processing_finished_at).toLocaleString() : "n/a"}</div>
            <div className="small">Raw result SHA-256 <code>{job.raw_result_sha256}</code></div>
            {exists ? <div className="notice">A sealed report already exists for this result.</div> : reportForm("blast_job", job.id)}
          </div>;
        })}{!(blastResult.data ?? []).length ? <div className="notice">No completed BLAST results are currently eligible.</div> : null}</div>
      </section>

      <section className="card" style={{ marginTop: 18 }}>
        <div className="eyebrow">NCBI</div><h3>Finalized live retrieval evidence</h3>
        {retrievalResult.error ? <div className="error">NCBI report sources could not be loaded.</div> : null}
        <div className="list">{(retrievalResult.data ?? []).map((retrieval) => {
          const exists = reportKeys.has(`sequence_retrieval:${retrieval.id}`);
          return <div className="item" key={retrieval.id}>
            <strong>NCBI {retrieval.source_database}: {retrieval.resolved_accession ?? retrieval.requested_accession}</strong>
            <div className="small">{retrieval.status.replaceAll("_", " ")} · source checked {retrieval.source_checked_at ? new Date(retrieval.source_checked_at).toLocaleString() : "n/a"}</div>
            {retrieval.source_response_sha256 ? <div className="small">Source response SHA-256 <code>{retrieval.source_response_sha256}</code></div> : null}
            {retrieval.result_message ? <div className="small">{retrieval.result_message}</div> : null}
            {exists ? <div className="notice">A sealed report already exists for this retrieval.</div> : reportForm("sequence_retrieval", retrieval.id)}
          </div>;
        })}{!(retrievalResult.data ?? []).length ? <div className="notice">No finalized NCBI retrievals are currently eligible.</div> : null}</div>
      </section>

      <section className="card" style={{ marginTop: 18 }}>
        <div className="eyebrow">Protein annotation</div><h3>Source-backed annotation evidence</h3>
        {annotationResult.error ? <div className="error">Protein-annotation report sources could not be loaded.</div> : null}
        <div className="list">{(annotationResult.data ?? []).map((annotation) => {
          const exists = reportKeys.has(`protein_annotation_job:${annotation.id}`);
          return <div className="item" key={annotation.id}>
            <strong>{annotation.protein_name ?? `RefSeq ${annotation.refseq_accession}`}</strong>
            <div className="small">{annotation.status.replaceAll("_", " ")} · RefSeq {annotation.refseq_accession}{annotation.uniprot_accession ? ` · UniProt ${annotation.uniprot_accession}` : ""}</div>
            <div className="actions" style={{ marginTop: 10 }}>
              <Link className="button" href={`/dashboard/protein-annotations/${annotation.id}`}>Open evidence</Link>
              {exists ? <span className="notice">A sealed report already exists.</span> : reportForm("protein_annotation_job", annotation.id)}
            </div>
          </div>;
        })}{!(annotationResult.data ?? []).length ? <div className="notice">No finalized protein-annotation outcomes are currently eligible.</div> : null}</div>
      </section>
    </main>
  );
}
