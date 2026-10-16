import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { createScientificNotebookEntry, deleteScientificNotebookEntry, updateScientificNotebookEntry } from "./actions";
import styles from "./notebook.module.css";

export const dynamic = "force-dynamic";

type NotebookParams = {
  project?: string;
  job?: string;
  kind?: string;
  error?: string;
  saved?: string;
  updated?: string;
  deleted?: string;
};

const noteKinds = ["observation", "hypothesis", "interpretation", "limitation"] as const;
type NoteKind = typeof noteKinds[number];

const MAX_DISPLAY = 100;

function formatTime(value: string) {
  return new Date(value).toLocaleString("en", {
    dateStyle: "medium", timeStyle: "short", timeZone: "UTC",
  }) + " UTC";
}

export default async function ScientificNotebookPage({
  searchParams,
}: { searchParams: Promise<NotebookParams> }) {
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (authError || !userId) redirect("/login");
  const params = await searchParams;
  const { data: projects, error: projectsError } = await supabase
    .from("projects").select("id,name,organization_id")
    .eq("status", "active").order("name", { ascending: true }).limit(150);

  const projectNames = new Map((projects ?? []).map(project => [project.id, project.name]));
  const projectId = params.project && projectNames.has(params.project) ? params.project : "";
  const validKind = noteKinds.includes(params.kind as NoteKind);
  const filterKind = validKind ? params.kind as NoteKind : "";
  const invalid = Boolean(params.project && !projectNames.has(params.project)) ||
    Boolean(params.kind && !validKind);

  const jobReference = params.job && /^[a-f0-9-]{36}$/i.test(params.job)
    ? await supabase.from("scientific_jobs")
      .select("id,project_id,job_type,status,result_sha256")
      .eq("id", params.job).eq("requested_by", userId).maybeSingle()
    : null;
  const linkedJob = !jobReference?.error && jobReference?.data?.status === "completed" &&
    typeof jobReference?.data?.result_sha256 === "string" &&
    projectNames.has(jobReference.data.project_id) &&
    (!projectId || projectId === jobReference.data.project_id)
    ? jobReference.data : null;
  const defaultProject = linkedJob?.project_id || projectId || projects?.[0]?.id || "";

  let query = supabase.from("scientific_notebook_entries")
    .select("id,project_id,scientific_job_id,source_result_sha256,title,body,note_kind,tags,created_at,updated_at")
    .eq("created_by", userId).order("created_at", { ascending: false }).limit(MAX_DISPLAY);
  if (projectId) query = query.eq("project_id", projectId);
  if (filterKind) query = query.eq("note_kind", filterKind);
  const { data: entries, error: entriesError } = invalid || projectsError
    ? { data: [], error: null }
    : await query;

  const errorMessage = projectsError
    ? "Project permissions could not be loaded."
    : invalid ? "This project or note type is unavailable."
    : entriesError ? "The research notebook is unavailable. The database migration may not be installed."
    : params.error ? params.error.slice(0, 240) : "";

  return (
    <main className={styles.shell}>
      <nav className={styles.breadcrumbs} aria-label="Notebook navigation">
        <Link href="/dashboard/ai">← Genithm chat</Link>
        <Link href="/dashboard/results">Scientific results</Link>
        <Link href="/dashboard/reports">Scientific reports</Link>
      </nav>
      <header className={styles.hero}>
        <div>
          <span className={styles.kicker}>GENITHM · SCIENTIFIC RESEARCH NOTEBOOK</span>
          <h1>Record your scientific thinking.</h1>
          <p>Write observations, hypotheses, interpretations and limitations in a private, project-scoped notebook. Link a completed analysis and preserve its recorded result fingerprint for traceability.</p>
        </div>
        <div className={styles.heroMark} aria-hidden="true">⌘</div>
      </header>

      {errorMessage ? <p role="alert" className={styles.alert}>{errorMessage}</p> : null}
      {params.saved || params.updated || params.deleted ? (
        <p role="status" className={styles.success}>
          {params.saved ? "Research note saved." : params.updated ? "Research note updated." : "Research note deleted."}
        </p>
      ) : null}

      <div className={styles.layout}>
        <section className={styles.editor} aria-label="Create research note">
          <div className={styles.sectionHead}>
            <span className={styles.kicker}>NEW ENTRY</span>
            <h2>Add a research note</h2>
          </div>
          {linkedJob ? (
            <div className={styles.source}>
              <strong>Linked completed analysis</strong>
              <Link href={"/dashboard/scientific-jobs/" + linkedJob.id}>
                {linkedJob.job_type.replaceAll("_", " ")} ↗
              </Link>
              <small>Recorded result SHA-256: {linkedJob.result_sha256}</small>
            </div>
          ) : params.job ? (
            <p className={styles.alert}>The requested scientific job is not a completed, accessible analysis. Create an unlinked note or choose another result.</p>
          ) : null}
          <form action={createScientificNotebookEntry} className={styles.form}>
            <label>Project
              <select name="project_id" defaultValue={defaultProject} required disabled={Boolean(linkedJob)}>
                <option value="" disabled>Select a project</option>
                {(projects ?? []).map(project => (
                  <option key={project.id} value={project.id}>{project.name}</option>
                ))}
              </select>
            </label>
            {linkedJob ? (
              <>
                <input type="hidden" name="project_id" value={linkedJob.project_id} />
                <input type="hidden" name="scientific_job_id" value={linkedJob.id} />
              </>
            ) : null}
            <label>Type
              <select name="note_kind" defaultValue="observation" required>
                {noteKinds.map(kind => <option key={kind} value={kind}>{kind[0].toUpperCase() + kind.slice(1)}</option>)}
              </select>
            </label>
            <label>Title
              <input name="title" type="text" placeholder="e.g. Protein charge interpretation" minLength={3}
                maxLength={160} required />
            </label>
            <label>Research notes
              <textarea name="body" rows={7} maxLength={8000} required
                placeholder="Record your observation, uncertainty, biological context and next steps. Distinguish computational findings from experimental validation." />
            </label>
            <label>Tags <span className={styles.optional}>(comma-separated, max 8)</span>
              <input name="tags" placeholder="protein, alignment, hypothesis" maxLength={220} />
            </label>
            <button type="submit" disabled={!defaultProject || Boolean(projectsError || entriesError)}>
              Save research note →
            </button>
          </form>
          <p className={styles.disclaimer}>These are researcher-authored notes, not automatically verified scientific claims. A linked fingerprint documents the recorded source job; inspect the original artifact to verify its bytes.</p>
        </section>

        <section className={styles.archive} aria-label="Saved scientific notes">
          <div className={styles.sectionHead}>
            <span className={styles.kicker}>YOUR RESEARCH ARCHIVE</span>
            <h2>Saved notes</h2>
          </div>
          <form action="/dashboard/notebook" method="get" className={styles.filters}>
            <label>Project
              <select name="project" defaultValue={projectId}>
                <option value="">All accessible projects</option>
                {(projects ?? []).map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
              </select>
            </label>
            <label>Note type
              <select name="kind" defaultValue={filterKind}>
                <option value="">All note types</option>
                {noteKinds.map(kind => <option key={kind} value={kind}>{kind}</option>)}
              </select>
            </label>
            <button type="submit">Filter</button>
            <Link href="/dashboard/notebook">Reset</Link>
          </form>
          {!errorMessage && !(entries ?? []).length ? (
            <div className={styles.empty}>No notebook entries match the current filters. Create your first research note to begin an auditable scientific journal.</div>
          ) : null}
          <div className={styles.entries}>
            {(entries ?? []).map(entry => (
              <article className={styles.entry} key={entry.id}>
                <div className={styles.entryMeta}>
                  <span className={styles.kind}>{entry.note_kind}</span>
                  <span>{projectNames.get(entry.project_id) ?? "Accessible project"}</span>
                  <span>{formatTime(entry.created_at)}</span>
                </div>
                <h3>{entry.title}</h3>
                <p className={styles.body}>{entry.body}</p>
                {entry.tags.length ? <div className={styles.tags}>{entry.tags.map(tag => <span key={tag}>#{tag}</span>)}</div> : null}
                {entry.scientific_job_id && entry.source_result_sha256 ? (
                  <div className={styles.lineage}>
                    <strong>Recorded scientific source</strong>
                    <code title={entry.source_result_sha256}>SHA-256 {entry.source_result_sha256.slice(0, 18)}…</code>
                    <Link href={"/dashboard/scientific-jobs/" + entry.scientific_job_id}>Inspect original result ↗</Link>
                  </div>
                ) : <span className={styles.unlinked}>Researcher-authored · no linked scientific job</span>}
                <details className={styles.edit}>
                  <summary>Edit note</summary>
                  <form action={updateScientificNotebookEntry} className={styles.form}>
                    <input name="entry_id" type="hidden" value={entry.id} />
                    <label>Type
                      <select name="note_kind" defaultValue={entry.note_kind}>
                        {noteKinds.map(kind => <option key={kind} value={kind}>{kind}</option>)}
                      </select>
                    </label>
                    <label>Title<input name="title" defaultValue={entry.title} maxLength={160} required /></label>
                    <label>Research notes<textarea name="body" defaultValue={entry.body} rows={5} maxLength={8000} required /></label>
                    <label>Tags<input name="tags" defaultValue={entry.tags.join(", ")} /></label>
                    <button type="submit">Save changes</button>
                  </form>
                </details>
                <form action={deleteScientificNotebookEntry} className={styles.delete}>
                  <input type="hidden" name="entry_id" value={entry.id} />
                  <button type="submit" aria-label={"Delete note: " + entry.title}>Delete note</button>
                </form>
              </article>
            ))}
          </div>
          <p className={styles.foot}>Showing the most recent {MAX_DISPLAY} entries. Source links and ownership are checked by Supabase policies.</p>
        </section>
      </div>
    </main>
  );
}
