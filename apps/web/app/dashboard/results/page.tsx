import Link from "next/link";
import { redirect } from "next/navigation";

import { ResearchActivityRefresh } from "@/components/research-activity-refresh";
import { ScientificComparisonPicker } from "@/components/scientific-comparison-picker";
import { createClient } from "@/lib/supabase/server";
import {
  activityFilter, activityScope, activityTitle, classifyActivity,
  sortActivityRows, statusLabel, statusQueryFilter,
  type ActivityRow,
} from "@/lib/scientific-activity";
import styles from "./results.module.css";

export const dynamic = "force-dynamic";

type ResultsSearch = { project?: string; state?: string; kind?: string };

export default async function ScientificResultsPage({
  searchParams,
}: { searchParams: Promise<ResultsSearch> }) {
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (authError || !userId) redirect("/login");

  const params = await searchParams;
  const state = activityFilter(params.state);
  const kind = activityScope(params.kind);
  const requestedProject = params.project || "all";
  const { data: accessibleProjects, error: projectError } = await supabase.from("projects")
    .select("id,name").eq("status", "active").order("name", { ascending: true }).limit(200);

  const projectNames = new Map((accessibleProjects ?? []).map((project) => [project.id, project.name]));
  const invalid = state === null || kind === null ||
    (requestedProject !== "all" && !projectNames.has(requestedProject));

  if (invalid) {
    return <main className={styles.shell}>
      <Link className={styles.back} href="/dashboard/ai">← Back to Genithm</Link>
      <h1>Scientific results</h1>
      <p role="alert" className={styles.alert}>Invalid or inaccessible research filter. No results were loaded.</p>
      <Link className={styles.open} href="/dashboard/results">Reset filters</Link>
    </main>;
  }

  const projectIds = requestedProject === "all"
    ? (accessibleProjects ?? []).map((project) => project.id)
    : [requestedProject];

  // All records are fetched through the researcher's cookie-backed RLS client.
  // requested_by is an additional explicit owner constraint; never use service_role.
  // A project query failure is fail-closed, not interpreted as an empty workspace.
  const allowed = !projectError && projectIds.length > 0;
  const scientificStatus = statusQueryFilter("scientific", state);
  const pipelineStatus = statusQueryFilter("pipeline", state);
  const scientificBase = supabase.from("scientific_jobs")
    .select("id,project_id,job_type,tool_id,tool_version,status,created_at,result_sha256")
    .eq("requested_by", userId).in("project_id", projectIds)
    .order("created_at", { ascending: false }).limit(30);
  const pipelineBase = supabase.from("research_pipeline_runs")
    .select("id,project_id,template,status,created_at,requested_accession")
    .eq("requested_by", userId).in("project_id", projectIds)
    .order("created_at", { ascending: false }).limit(30);

  const [scientificResult, pipelineResult] = await Promise.all([
    allowed && kind !== "pipeline"
      ? scientificStatus ? scientificBase.in("status", [...scientificStatus]) : scientificBase
      : Promise.resolve({ data: null, error: null }),
    allowed && kind !== "scientific"
      ? pipelineStatus ? pipelineBase.in("status", [...pipelineStatus]) : pipelineBase
      : Promise.resolve({ data: null, error: null }),
  ]);

  const loadError = Boolean(projectError || scientificResult.error || pipelineResult.error);
  const rows: ActivityRow[] = loadError ? [] : sortActivityRows([
    ...(scientificResult.data ?? []).map((run) => ({
      id: run.id,
      kind: "scientific" as const,
      projectId: run.project_id,
      projectName: projectNames.get(run.project_id) ?? "Research project",
      title: activityTitle("scientific", run.job_type),
      status: run.status,
      createdAt: run.created_at,
      resultSha256: run.result_sha256,
      href: `/dashboard/scientific-jobs/${run.id}`,
    })),
    ...(pipelineResult.data ?? []).map((run) => ({
      id: run.id,
      kind: "pipeline" as const,
      projectId: run.project_id,
      projectName: projectNames.get(run.project_id) ?? "Research project",
      title: activityTitle("pipeline", run.template),
      status: run.status,
      createdAt: run.created_at,
      resultSha256: null,
      href: `/dashboard/pipelines/${run.id}`,
    })),
  ]).slice(0, 40);

  const comparableChoices = loadError ? [] : (scientificResult.data ?? [])
    .filter((job) => job.status === "completed" &&
      (job.job_type === "protein_properties" || job.job_type === "pairwise_alignment") &&
      typeof job.result_sha256 === "string" && /^[0-9a-f]{64}$/.test(job.result_sha256))
    .map((job) => ({
      id: job.id,
      jobType: job.job_type as "protein_properties" | "pairwise_alignment",
      projectName: projectNames.get(job.project_id) ?? "Research project",
      createdAt: job.created_at,
    }));

  const active = rows.filter((row) => classifyActivity(row.kind, row.status) === "active").length;
  const completed = rows.filter((row) => classifyActivity(row.kind, row.status) === "completed").length;
  const stopped = rows.filter((row) => classifyActivity(row.kind, row.status) === "stopped").length;

  return (
    <main className={styles.shell} aria-label="Recorded scientific work">
      <ResearchActivityRefresh active={active > 0} />
      <nav className={styles.crumbs} aria-label="Research navigation">
        <Link href="/dashboard/ai">← Bioinformatics chat</Link>
        <Link href="/dashboard/tools">Scientific tools</Link>
        <Link href="/dashboard/ai/research">Approved research archive</Link>
        <Link href="/dashboard/notebook">Scientific notebook</Link>
        <Link href="/dashboard/variant-qc">Variant QC Lab</Link>
        <Link href="/dashboard/fastq-qc">FASTQ QC Lab</Link>
        <Link href="/dashboard/results/studies">Saved comparisons</Link>
      </nav>
      <header className={styles.intro}>
        <div><span className={styles.kicker}>GENITHM / SCIENTIFIC WORKSPACE</span>
          <h1>Scientific results & activity</h1>
          <p>Track real analyses from your accessible research projects. Open a run to review parameters, source records, provenance and evidence-gated downloads.</p>
        </div>
        <Link className={styles.primary} href="/dashboard/tools">＋ Start an analysis</Link>
      </header>

      <form action="/dashboard/results" method="get" className={styles.filters}>
        <label htmlFor="results-project">Project
          <select id="results-project" name="project" defaultValue={requestedProject}>
            <option value="all">All accessible projects</option>
            {(accessibleProjects ?? []).map((project) =>
              <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
        </label>
        <label htmlFor="results-kind">Type
          <select id="results-kind" name="kind" defaultValue={kind ?? "all"}>
            <option value="all">All analyses</option>
            <option value="scientific">Scientific jobs</option>
            <option value="pipeline">Research pipelines</option>
          </select>
        </label>
        <label htmlFor="results-state">Status
          <select id="results-state" name="state" defaultValue={state ?? "all"}>
            <option value="all">All states</option>
            <option value="active">Running or queued</option>
            <option value="completed">Completed</option>
            <option value="stopped">Failed or cancelled</option>
          </select>
        </label>
        <button type="submit">Apply filters</button>
        <Link href="/dashboard/results">Clear</Link>
      </form>

      <section className={styles.stats} aria-label="Counts in displayed results">
        <div><span>Records shown</span><strong>{rows.length}</strong></div>
        <div><span>Active</span><strong>{active}</strong></div>
        <div><span>Completed</span><strong>{completed}</strong></div>
        <div><span>Stopped</span><strong>{stopped}</strong></div>
      </section>
      <p className={styles.note}>Counts describe only the records currently displayed, not all historical work. Active statuses refresh while this page is open. Completion is an execution state, not independent validation of biological conclusions.</p>
      {loadError ? <div role="alert" className={styles.alert}>
        Scientific activity could not be loaded securely. Refresh and try again; no results were inferred.
      </div> : null}
      <ScientificComparisonPicker choices={comparableChoices} />
      <section className={styles.entries} aria-label="Latest research execution records">
        {rows.map((row) => {
          const category = classifyActivity(row.kind, row.status);
          return <article className={styles.entry} key={`${row.kind}:${row.id}`}>
            <div className={styles.entryBody}>
              <div className={styles.entryTop}>
                <span className={styles.kind}>{row.kind === "scientific" ? "Scientific job" : "Research pipeline"}</span>
                <span className={`${styles.state} ${category === "completed" ? styles.complete :
                  category === "stopped" ? styles.stopped : category === "active" ? styles.active : ""}`}>
                  {statusLabel(row.status)}
                </span>
              </div>
              <h2>{row.title}</h2>
              <p>{row.projectName} · {new Date(row.createdAt).toLocaleString("en", {timeZone:"UTC", dateStyle:"medium", timeStyle:"short"})} UTC</p>
              {row.kind === "scientific" && category === "completed" ? <p className={styles.provenance}>
                {row.resultSha256 ? "A result fingerprint is recorded; verify the artifact on the detail page." :
                  "No result fingerprint is available in this record."}
              </p> : null}
            </div>
            <Link className={styles.open} href={row.href}>Review {row.kind === "scientific" ? "result" : "pipeline"} →</Link>
          </article>;
        })}
        {!loadError && !rows.length ? <div className={styles.empty}>
          No recorded analyses match these filters. You can run a new analysis from Scientific tools.
        </div> : null}
      </section>
      <div className={styles.footer}>
        Showing at most 40 recent matching entries (up to 30 per execution type).
        <Link href="/dashboard/ai/research">Find older approved chat studies →</Link>
      </div>
    </main>
  );
}
