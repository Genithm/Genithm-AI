import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { collectOperations, type OperationsSourceRow, type Pipeline } from "@/lib/research-operations";
import { ResearchOperationsBoard } from "./research-operations-board";
import styles from "./operations.module.css";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PER_PIPELINE = 60;
const SOURCE_NAMES: Pipeline[] = [
  "scientific", "blast", "ncbi", "protein_annotation", "sequence_input",
  "ai_plan", "ai_interpretation", "ai_followup", "ai_workflow",
];

export default async function ResearchOperationsPage({
  searchParams,
}: {
  searchParams: Promise<{ project_id?: string }>;
}) {
  const query = await searchParams;
  const projectId = query.project_id;
  if (projectId !== undefined && !UUID.test(projectId)) notFound();

  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (!claimsData?.claims?.sub) redirect("/login");

  const projectsQuery = supabase.from("projects")
    .select("id,name,status").order("name", { ascending: true }).limit(100);

  // All queries use the current signed-in user's Supabase client and existing RLS.
  // Do not use service_role or expose raw prompts, answers or biological artifacts.
  const scientific = supabase.from("scientific_jobs")
    .select("id,project_id,status,job_type,tool_id,processing_attempts,created_at,updated_at,processing_started_at")
    .order("created_at", { ascending: false }).limit(PER_PIPELINE);
  const blast = supabase.from("blast_jobs")
    .select("id,project_id,status,program,database_name,submission_attempts,created_at,updated_at,processing_started_at")
    .order("created_at", { ascending: false }).limit(PER_PIPELINE);
  const ncbi = supabase.from("sequence_retrievals")
    .select("id,project_id,status,requested_accession,processing_attempts,created_at,updated_at,processing_started_at")
    .order("created_at", { ascending: false }).limit(PER_PIPELINE);
  const protein = supabase.from("protein_annotation_jobs")
    .select("id,project_id,status,refseq_accession,processing_attempts,created_at,updated_at,processing_started_at")
    .order("created_at", { ascending: false }).limit(PER_PIPELINE);
  const inputs = supabase.from("sequence_uploads")
    .select("id,project_id,status,original_filename,processing_attempts,created_at,updated_at,processing_started_at")
    .order("created_at", { ascending: false }).limit(PER_PIPELINE);
  const planner = supabase.from("ai_plan_requests")
    .select("id,project_id,conversation_id,status,action_type,requires_confirmation,processing_attempts,created_at,updated_at,processing_started_at")
    .order("created_at", { ascending: false }).limit(PER_PIPELINE);
  const interpretations = supabase.from("ai_interpretation_requests")
    .select("id,project_id,conversation_id,status,processing_attempts,created_at,updated_at,processing_started_at")
    .order("created_at", { ascending: false }).limit(PER_PIPELINE);
  const followups = supabase.from("ai_evidence_followup_requests")
    .select("id,project_id,conversation_id,status,processing_attempts,created_at,updated_at,processing_started_at")
    .order("created_at", { ascending: false }).limit(PER_PIPELINE);
  const workflows = supabase.from("ai_workflow_runs")
    .select("id,project_id,conversation_id,status,workflow_type,created_at,updated_at")
    .order("created_at", { ascending: false }).limit(PER_PIPELINE);

  if (projectId) {
    scientific.eq("project_id", projectId);
    blast.eq("project_id", projectId);
    ncbi.eq("project_id", projectId);
    protein.eq("project_id", projectId);
    inputs.eq("project_id", projectId);
    planner.eq("project_id", projectId);
    interpretations.eq("project_id", projectId);
    followups.eq("project_id", projectId);
    workflows.eq("project_id", projectId);
  }

  const results = await Promise.all([
    projectsQuery, scientific, blast, ncbi, protein, inputs, planner,
    interpretations, followups, workflows,
  ]);
  const [projectResult, ...sources] = results;
  const projects = projectResult.data ?? [];
  if (projectId && !projects.some(project => project.id === projectId)) notFound();

  const missingSources = SOURCE_NAMES.filter((_, index) => sources[index]?.error);
  const sourceRows: Partial<Record<Pipeline, readonly OperationsSourceRow[]>> = {};
  SOURCE_NAMES.forEach((pipeline, index) => {
    const result = sources[index];
    if (!result?.error && Array.isArray(result?.data)) {
      // Fields selected above are structurally compatible with the intentionally
      // minimal OperationsSourceRow read model.
      sourceRows[pipeline] = result.data as OperationsSourceRow[];
    }
  });
  const refreshedAt = new Date().toISOString();
  const rows = collectOperations(sourceRows, Date.parse(refreshedAt));

  return (
    <main className={"container dashboard " + styles.screen}>
      <header className={styles.hero}>
        <div>
          <div className={styles.eyebrow}>Research operations</div>
          <h1>Every experiment, one command center.</h1>
          <p>Inspect scientific computation, source retrieval, sequence validation and AI orchestration from one authorized research workspace.</p>
        </div>
        <div className={styles.heroActions}>
          <Link className="button" href="/dashboard/tools">Advanced tools</Link>
          <Link className="button" href="/dashboard/ai">AI workspace</Link>
        </div>
      </header>

      {projectResult.error ? (
        <div className="error" role="alert">Projects could not be loaded. Project filtering and result interpretation may be incomplete.</div>
      ) : null}

      <ResearchOperationsBoard
        rows={rows}
        projects={projects.map(p => ({ id: p.id, name: p.name }))}
        selectedProjectId={projectId ?? ""}
        snapshotAt={refreshedAt}
        sourcesLoaded={SOURCE_NAMES.length - missingSources.length}
        missingSources={missingSources}
        perPipelineLimit={PER_PIPELINE}
      />
    </main>
  );
}
