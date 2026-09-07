import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { createOrganization, createProject, requestBlastJob, requestNcbiSequence } from "./actions";
import { SequenceUploadPanel } from "./sequence-upload-panel";

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function warningLabels(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string").map((item) => item.replaceAll("_", " "));
}

type StatisticsSummary = {
  gcContentPercent: number | null;
  gcMethod: string | null;
  minLength: number;
  maxLength: number;
  meanLength: number;
  gapCount: number;
  composition: Array<[string, number]>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseStatistics(value: unknown): StatisticsSummary | null {
  if (!isRecord(value)) return null;
  const recordLength = value.record_length;
  const composition = value.composition;
  if (!isRecord(recordLength) || !isRecord(composition)) return null;
  const minLength = numberValue(recordLength.min);
  const maxLength = numberValue(recordLength.max);
  const meanLength = numberValue(recordLength.mean);
  const gapCount = numberValue(value.gap_count);
  if (minLength === null || maxLength === null || meanLength === null || gapCount === null) return null;
  return {
    gcContentPercent: numberValue(value.gc_content_percent),
    gcMethod: typeof value.gc_method === "string" ? value.gc_method : null,
    minLength,
    maxLength,
    meanLength,
    gapCount,
    composition: Object.entries(composition)
      .filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1]))
      .sort(([a], [b]) => a.localeCompare(b)),
  };
}

function parseBlastHits(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter(isRecord).slice(0, 5) : [];
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) redirect("/login");

  const retrievalQuery = (supabase.from as any)("sequence_retrievals")
    .select("id,project_id,source_database,requested_accession,resolution_mode,freshness_policy,resolved_accession,record_title,organism,reported_length,record_updated_date,status,sequence_upload_id,connector_version,source_checked_at,source_retrieved_at,source_response_sha256,source_response_bytes,result_message,processing_attempts,processing_error,created_at")
    .order("created_at", { ascending: false })
    .limit(20);
  const blastQuery = (supabase.from as any)("blast_jobs")
    .select("id,project_id,query_upload_id,program,database_name,expect_value,max_targets,low_complexity_filter,status,query_sha256,remote_rid,poll_count,service_version,blast_version,database_reported,database_release,result_summary,normalized_hits,submitted_at,processing_finished_at,processing_error,created_at")
    .order("created_at", { ascending: false })
    .limit(20);

  const [{ data: organizations }, { data: projects }, { data: sequenceUploadRows }, retrievalResult, blastResult] = await Promise.all([
    supabase.from("organizations").select("id,name,slug,created_at").order("created_at", { ascending: true }),
    supabase.from("projects").select("id,organization_id,name,description,status,created_at").order("created_at", { ascending: false }),
    supabase.from("sequence_uploads").select("*").order("created_at", { ascending: false }).limit(50),
    retrievalQuery,
    blastQuery,
  ]);

  type SequenceUploadRow = NonNullable<typeof sequenceUploadRows>[number] & {
    sequence_statistics?: unknown;
    statistics_version?: string | null;
    statistics_calculated_at?: string | null;
  };
  const sequenceUploads = (sequenceUploadRows ?? []) as SequenceUploadRow[];
  const readyBlastInputs = sequenceUploads.filter((upload) => upload.status === "ready" && upload.sequence_count === 1 && !!upload.sha256);
  const retrievals = (retrievalResult.data ?? []) as any[];
  const blastJobs = (blastResult.data ?? []) as any[];
  const projectOptions = (projects ?? []).map((project) => ({ id: project.id, organization_id: project.organization_id, name: project.name }));

  return (
    <main className="container dashboard">
      <header className="dashboard-header">
        <div><div className="eyebrow">Secure workspace</div><h2>Research dashboard</h2><p className="small">Signed in as {String(claimsData.claims.email ?? userId)}</p></div>
        <form action="/auth/signout" method="post"><button className="button">Sign out</button></form>
      </header>
      {params.error ? <p className="error">{params.error}</p> : null}

      <div className="section-grid">
        <section className="card">
          <h2>Organizations</h2>
          <form className="stack" action={createOrganization}>
            <label>Name<input name="name" minLength={2} maxLength={100} required /></label>
            <label>Slug (optional)<input name="slug" maxLength={63} placeholder="my-lab" /></label>
            <button className="button primary">Create organization</button>
          </form>
          <div className="list" style={{ marginTop: 18 }}>{(organizations ?? []).map((org) => <div className="item" key={org.id}><strong>{org.name}</strong><div className="small">{org.slug}</div></div>)}{!organizations?.length ? <p>No organization yet.</p> : null}</div>
        </section>
        <section className="card">
          <h2>Projects</h2>
          {organizations?.length ? <form className="stack" action={createProject}>
            <label>Organization<select className="select" name="organization_id" required>{organizations.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}</select></label>
            <label>Project name<input name="name" maxLength={160} required /></label>
            <label>Description<textarea name="description" maxLength={5000} /></label>
            <button className="button primary">Create project</button>
          </form> : <div className="notice">Create an organization first.</div>}
          <div className="list" style={{ marginTop: 18 }}>{(projects ?? []).map((project) => <div className="item" key={project.id}><strong>{project.name}</strong><div className="small">{project.status}</div>{project.description ? <p>{project.description}</p> : null}</div>)}{!projects?.length ? <p>No projects yet.</p> : null}</div>
        </section>
      </div>

      <section className="card" style={{ marginTop: 18 }}>
        <div className="eyebrow">Authoritative sequence retrieval</div><h2>Retrieve from NCBI</h2>
        <p>Every new request checks the live NCBI source. An accession without a version resolves the current version at request time; an accession with a version such as <code>NM_000546.6</code> requires that exact record for reproducibility.</p>
        {projectOptions.length ? <form className="stack" action={requestNcbiSequence} style={{ maxWidth: 680 }}>
          <label>Project<select className="select" name="project_id" required>{projectOptions.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
          <label>NCBI database<select className="select" name="database_name" required defaultValue="nucleotide"><option value="nucleotide">Nucleotide</option><option value="protein">Protein</option></select></label>
          <label>Accession<input name="accession" required maxLength={64} placeholder="NM_000546 or NM_000546.6" autoCapitalize="characters" /></label>
          <button className="button primary">Queue live NCBI retrieval</button>
        </form> : <div className="notice">Create a project before requesting an NCBI record.</div>}
        <div className="list" style={{ marginTop: 18 }}>{retrievals.map((item) => <div className="item" key={item.id}>
          <strong>NCBI {item.source_database}: {item.resolved_accession ?? item.requested_accession}</strong>
          <div className="small">{String(item.status).replaceAll("_", " ")} · requested {new Date(item.created_at).toLocaleString()}</div>
          <div className="small">Freshness: {item.resolution_mode === "exact_version" ? "exact accession.version" : "latest version at request time"} · policy: live source, no silent cache reuse</div>
          {item.source_checked_at ? <div className="small">Authoritative source checked: {new Date(item.source_checked_at).toLocaleString()}</div> : null}
          {item.record_title ? <div>{item.record_title}</div> : null}
          {item.organism || item.reported_length ? <div className="small">{item.organism ?? "Organism unavailable"}{item.reported_length ? ` · ${item.reported_length} residues/bases` : ""}</div> : null}
          {item.status === "retrieved" ? <div className="small">Connector: {item.connector_version ?? "unknown"}{item.record_updated_date ? ` · NCBI record updated ${item.record_updated_date}` : ""}{item.source_response_sha256 ? ` · Source SHA-256 ${String(item.source_response_sha256).slice(0, 16)}…` : ""}{item.source_response_bytes ? ` · ${formatBytes(Number(item.source_response_bytes))} source response` : ""}</div> : null}
          {item.result_message ? <div className={item.status === "rejected" || item.status === "not_found" ? "error" : "small"}>{item.result_message}</div> : null}
          {item.processing_error ? <div className="error">Retrieval error: {item.processing_error}</div> : null}
        </div>)}{!retrievals.length ? <div className="notice">No NCBI retrieval requests yet.</div> : null}</div>
      </section>

      <section className="card" style={{ marginTop: 18 }}>
        <div className="eyebrow">Similarity search</div><h2>BLAST analysis</h2>
        <p>BLAST runs asynchronously through a controlled worker. Genithm validates the input and parameters, stores the raw XML privately, and normalizes scientific hits before they are shown here.</p>
        {readyBlastInputs.length ? <form className="stack" action={requestBlastJob} style={{ maxWidth: 720 }}>
          <label>Project<select className="select" name="project_id" required>{projectOptions.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
          <label>Validated single-record sequence<select className="select" name="query_upload_id" required>{readyBlastInputs.map((upload) => <option key={upload.id} value={upload.id}>{upload.original_filename} · {upload.sequence_type} · {upload.residue_count} residues/bases</option>)}</select></label>
          <label>Program<select className="select" name="program" required defaultValue="blastn"><option value="blastn">blastn → NCBI core_nt</option><option value="blastp">blastp → Swiss-Prot</option></select></label>
          <label>E-value threshold<input name="expect_value" type="number" min="1e-180" max="1000" step="any" defaultValue="10" required /></label>
          <label>Maximum hits<input name="max_targets" type="number" min="1" max="20" defaultValue="20" required /></label>
          <label><input name="low_complexity_filter" type="checkbox" defaultChecked /> Low-complexity filtering</label>
          <button className="button primary">Queue BLAST analysis</button>
        </form> : <div className="notice">A ready single-record FASTA is required before BLAST can run.</div>}

        <div className="list" style={{ marginTop: 18 }}>{blastJobs.map((job) => {
          const hits = parseBlastHits(job.normalized_hits);
          return <div className="item" key={job.id}>
            <strong>{String(job.program).toUpperCase()} · {job.database_name}</strong>
            <div className="small">{String(job.status).replaceAll("_", " ")} · E-value ≤ {job.expect_value} · max {job.max_targets} hits · requested {new Date(job.created_at).toLocaleString()}</div>
            {job.remote_rid ? <div className="small">NCBI RID: {job.remote_rid} · polls: {job.poll_count}</div> : null}
            {job.status === "completed" ? <>
              <div className="small">Tool: {job.blast_version ?? "unknown"} · Database: {job.database_reported ?? job.database_name}{job.database_release ? ` · ${job.database_release}` : ""}</div>
              <div className="small">Query SHA-256: {String(job.query_sha256).slice(0, 16)}…</div>
              {hits.map((hit, index) => <div className="notice" key={`${job.id}-${index}`} style={{ marginTop: 8 }}>
                <strong>#{String(hit.rank ?? index + 1)} {String(hit.subject_id ?? "unknown subject")}</strong>
                {hit.title ? <div>{String(hit.title)}</div> : null}
                <div className="small">Identity {Number(hit.identity_percent ?? 0).toFixed(2)}% · Coverage {Number(hit.query_coverage_percent ?? 0).toFixed(2)}% · E-value {String(hit.e_value ?? "n/a")} · Bit score {String(hit.bit_score ?? "n/a")}</div>
              </div>)}
              {!hits.length ? <div className="notice">BLAST completed with no normalized hits.</div> : null}
            </> : null}
            {job.processing_error ? <div className="error">BLAST error: {job.processing_error}</div> : null}
          </div>;
        })}{!blastJobs.length ? <div className="notice">No BLAST analyses yet.</div> : null}</div>
      </section>

      <section className="card" style={{ marginTop: 18 }}>
        <div className="dashboard-header"><div><div className="eyebrow">Sequence ingestion</div><h2>Private FASTA inputs</h2><p>Files are private. Scientific metadata and statistics are produced by Genithm&apos;s deterministic worker and stored with versioned provenance.</p></div></div>
        <div className="section-grid"><SequenceUploadPanel projects={projectOptions} userId={userId} /><div><h2>Recent uploads</h2><div className="list">
          {sequenceUploads.map((upload) => {
            const warnings = warningLabels(upload.validation_warnings);
            const statistics = parseStatistics(upload.sequence_statistics);
            return <div className="item" key={upload.id}>
              <strong>{upload.original_filename}</strong><div className="small">{formatBytes(upload.file_size_bytes)} · {upload.status.replaceAll("_", " ")}</div>
              {upload.status === "ready" ? <><div className="small">{upload.sequence_type ?? "unknown"} · {upload.sequence_count ?? 0} records · {upload.residue_count ?? 0} residues</div>
                {statistics ? <div className="notice" style={{ marginTop: 10 }}><strong>Deterministic sequence statistics</strong><div className="small">Length min / mean / max: {statistics.minLength} / {statistics.meanLength} / {statistics.maxLength}</div>{statistics.gcContentPercent !== null ? <div className="small">GC content: {statistics.gcContentPercent.toFixed(3)}%{statistics.gcMethod ? ` · ${statistics.gcMethod.replaceAll("_", " ")}` : ""}</div> : null}<div className="small">Gap characters: {statistics.gapCount}</div>{statistics.composition.length ? <div className="small">Composition: {statistics.composition.map(([symbol, count]) => `${symbol}:${count}`).join(" · ")}</div> : null}<div className="small">Statistics engine: {upload.statistics_version ?? "unknown"}</div></div> : null}
                <div className="small">Validator: {upload.validator_version ?? "unknown"}{upload.sha256 ? ` · SHA-256 ${upload.sha256.slice(0, 16)}…` : ""}</div>{warnings.length ? <div className="small">Warnings: {warnings.join(", ")}</div> : null}</> : null}
              {upload.status === "rejected" && upload.validation_error ? <div className="error">Rejected: {upload.validation_error}</div> : null}{upload.status === "error" && upload.processing_error ? <div className="error">Processing error: {upload.processing_error}</div> : null}
            </div>;
          })}{!sequenceUploads.length ? <div className="notice">No sequence inputs uploaded yet.</div> : null}
        </div></div></div>
      </section>
    </main>
  );
}
