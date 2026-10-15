import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import {
  ARCHIVE_PAGE_SIZE, archiveCursorPredicate, archiveStatus, archiveTemplate,
  parseResearchArchiveSearch, researchArchiveHref, type ArchiveSearch,
} from "@/lib/research-archive";
import styles from "./research-archive.module.css";

export default async function ResearchArchivePage({
  searchParams,
}: { searchParams: Promise<ArchiveSearch> }) {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) redirect("/login");

  const filter = parseResearchArchiveSearch(await searchParams);
  const { data: projectOptions } = await supabase
    .from("projects")
    .select("id,name")
    .order("name", { ascending: true })
    .limit(200);

  // Malformed project or cursor parameters are not silently treated as a
  // request for all data. They yield no rows and an actionable reset link.
  if (filter.invalid) {
    return (
      <main className={styles.shell}>
        <Link href="/dashboard/ai">← Back to Genithm chat</Link>
        <h1>Research history</h1>
        <p role="alert">Invalid research history filter or pagination cursor.</p>
        <Link href="/dashboard/ai/research">Reset archive filters</Link>
      </main>
    );
  }

  // Fail closed if a project locator is inaccessible through current RLS.
  const selectedProject = filter.projectId
    ? await supabase.from("projects").select("id").eq("id", filter.projectId).maybeSingle()
    : null;
  const authorizedProjectId = filter.projectId && selectedProject?.data?.id === filter.projectId
    ? filter.projectId : null;
  if (filter.projectId && !authorizedProjectId) {
    return (
      <main className={styles.shell}>
        <Link href="/dashboard/ai">← Back to Genithm chat</Link>
        <h1>Research history</h1>
        <p role="alert">The requested project is unavailable.</p>
        <Link href="/dashboard/ai/research">Show accessible research</Link>
      </main>
    );
  }

  // The archive is a message index, never a free-ranging scan of another
  // researcher's pipeline runs. RLS plus explicit user and role constraints
  // establish which conversations and approved run locators may be shown.
  let messageQuery = supabase.from("ai_messages")
    .select("id,conversation_id,project_id,created_at,research_pipeline_run_id")
    .eq("conversation_owner_id", userId)
    .eq("role", "user")
    .not("research_pipeline_run_id", "is", null)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(ARCHIVE_PAGE_SIZE + 1);

  if (authorizedProjectId) messageQuery = messageQuery.eq("project_id", authorizedProjectId);
  if (filter.cursor) messageQuery = messageQuery.or(archiveCursorPredicate(filter.cursor));

  const { data: linkedMessages, error: messagesError } = await messageQuery;
  const pageMessages = (linkedMessages ?? []).slice(0, ARCHIVE_PAGE_SIZE);
  const hasNextPage = (linkedMessages ?? []).length > ARCHIVE_PAGE_SIZE;

  const conversationIds = [...new Set(pageMessages.map((message) => message.conversation_id))];
  const projectIds = [...new Set(pageMessages.map((message) => message.project_id))];
  const runIds = [...new Set(pageMessages
    .map((message) => message.research_pipeline_run_id)
    .filter((id): id is string => Boolean(id)))];

  const [
    { data: conversationRows, error: conversationsError },
    { data: runRows, error: runsError },
    { data: projectRows, error: projectsError },
  ] = await Promise.all([
    conversationIds.length
      ? supabase.from("ai_conversations")
          .select("id,title,project_id,created_by")
          .eq("created_by", userId)
          .in("id", conversationIds)
      : Promise.resolve({ data: [], error: null }),
    runIds.length && projectIds.length
      ? supabase.from("research_pipeline_runs")
          .select("id,template,status,requested_accession,project_id,requested_by")
          .eq("requested_by", userId)
          .in("project_id", projectIds)
          .in("id", runIds)
      : Promise.resolve({ data: [], error: null }),
    projectIds.length
      ? supabase.from("projects").select("id,name").in("id", projectIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const conversations = new Map((conversationRows ?? []).map((row) => [row.id, row]));
  const pipelines = new Map((runRows ?? []).map((row) => [row.id, row]));
  const projects = new Map((projectRows ?? []).map((row) => [row.id, row.name]));

  const archiveError = messagesError || conversationsError || runsError || projectsError;

  const entries = archiveError ? [] : pageMessages.flatMap((message) => {
    const conversation = conversations.get(message.conversation_id);
    const pipeline = message.research_pipeline_run_id
      ? pipelines.get(message.research_pipeline_run_id) : null;
    if (!pipeline || !conversation ||
        conversation.project_id !== message.project_id ||
        conversation.created_by !== userId ||
        pipeline.project_id !== message.project_id ||
        pipeline.requested_by !== userId) return [];
    return [{
      id: message.id,
      conversationId: message.conversation_id,
      conversationTitle: conversation.title,
      projectName: projects.get(message.project_id) ?? "Accessible project",
      pipelineId: pipeline.id,
      template: pipeline.template,
      status: pipeline.status,
      accession: pipeline.requested_accession,
      createdAt: message.created_at,
    }];
  });
  const last = pageMessages[pageMessages.length - 1];
  const nextCursor = !archiveError && hasNextPage && last ? { time: last.created_at, id: last.id } : null;

  return (
    <main className={styles.shell}>
      <nav className={styles.crumbs} aria-label="Research archive navigation">
        <Link href="/dashboard/ai">← Genithm chat</Link>
        <Link href="/dashboard/reports">Reports</Link>
      </nav>
      <header className={styles.intro}>
        <div className="eyebrow">Genithm science archive</div>
        <h1>Approved research history</h1>
        <p>Recover NCBI studies from older conversations. Each entry is linked to the original saved user request, scoped to your account and accessible project.</p>
      </header>

      <form className={styles.filter} action="/dashboard/ai/research" method="get">
        <label htmlFor="archive-project">Project</label>
        <select id="archive-project" name="project" defaultValue={authorizedProjectId ?? ""}>
          <option value="">All accessible projects</option>
          {(projectOptions ?? []).map((project) => (
            <option key={project.id} value={project.id}>{project.name}</option>
          ))}
        </select>
        <button type="submit">Filter research</button>
      </form>

      <p className={styles.disclaimer}>
        An engine status describes the recorded workflow, not independently validated biological findings.
        Open a study to inspect scientific evidence and use authenticated downloads.
      </p>

      {archiveError ? (
        <p className={styles.failure} role="alert">Research history could not be loaded. Refresh or try again.</p>
      ) : (
        <>
          <div className={styles.list} aria-label="Approved research entries">
            {entries.map((item) => (
              <article className={styles.entry} key={item.id}>
                <div className={styles.entryHead}>
                  <strong>{archiveTemplate(item.template)}</strong>
                  <span className={styles.status}>{archiveStatus(item.status)}</span>
                </div>
                <dl className={styles.details}>
                  <div><dt>Reference</dt><dd><code>{item.accession}</code></dd></div>
                  <div><dt>Project</dt><dd>{item.projectName}</dd></div>
                  <div><dt>Conversation</dt><dd>{item.conversationTitle}</dd></div>
                  <div><dt>Requested (UTC)</dt><dd>{new Date(item.createdAt).toISOString().replace("T", " ").replace("Z", " UTC")}</dd></div>
                </dl>
                <Link className={styles.open} href={`/dashboard/ai/${item.conversationId}?pipeline_id=${item.pipelineId}&source_message_id=${item.id}`}>
                  Reopen original research →
                </Link>
              </article>
            ))}
          </div>
          {!entries.length ? (
            <div className={styles.empty}>
              No accessible approved research found in this page.
              {hasNextPage ? " Some older entries may be available on the next page." : ""}
            </div>
          ) : null}
          <nav className={styles.pagination} aria-label="Archive pages">
            {filter.cursor ? (
              <Link href={researchArchiveHref(authorizedProjectId, null)}>Return to newest</Link>
            ) : <span>Newest approved requests</span>}
            {nextCursor ? (
              <Link href={researchArchiveHref(authorizedProjectId, nextCursor)}>Older research →</Link>
            ) : <span>End of available history</span>}
          </nav>
        </>
      )}
    </main>
  );
}
