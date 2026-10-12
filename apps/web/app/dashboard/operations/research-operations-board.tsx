"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";

import {
  PIPELINES, summarizeOperations, type Operation, type OperationState, type Pipeline,
} from "@/lib/research-operations";
import styles from "./operations.module.css";

type ProjectOption = { id: string; name: string };
const stateNames: Record<OperationState, string> = {
  queued: "Queued", running: "Running", needs_action: "Needs approval",
  completed: "Completed", failed: "Failed", cancelled: "Cancelled", unknown: "Unknown",
};
const filterOptions: Array<{ value: string; text: string }> = [
  { value: "all", text: "All states" }, { value: "attention", text: "Needs review" },
  { value: "queued", text: "Queued" }, { value: "running", text: "Running" },
  { value: "needs_action", text: "Needs approval" }, { value: "completed", text: "Completed" },
  { value: "failed", text: "Failed" }, { value: "cancelled", text: "Cancelled" },
  { value: "unknown", text: "Unknown" },
];
const categoryNames: Record<Pipeline, string> = {
  scientific: "Scientific computation",
  blast: "BLAST",
  ncbi: "NCBI retrieval",
  protein_annotation: "Protein annotation",
  sequence_input: "Sequence validation",
  ai_plan: "AI planning",
  ai_interpretation: "AI interpretation",
  ai_followup: "Evidence follow-up",
  ai_workflow: "AI workflows",
};

function age(seconds: number | null) {
  if (seconds === null) return "Timing unavailable";
  if (seconds < 60) return seconds + "s";
  if (seconds < 3600) return Math.floor(seconds / 60) + "m";
  if (seconds < 86400) return Math.floor(seconds / 3600) + "h " +
    Math.floor(seconds % 3600 / 60) + "m";
  return Math.floor(seconds / 86400) + "d";
}
function stamp(value: string) {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toLocaleString() : "Timestamp unavailable";
}

export function ResearchOperationsBoard({
  rows, projects, selectedProjectId, snapshotAt, sourcesLoaded, missingSources, perPipelineLimit,
}: {
  rows: Operation[];
  projects: ProjectOption[];
  selectedProjectId: string;
  snapshotAt: string;
  sourcesLoaded: number;
  missingSources: Pipeline[];
  perPipelineLimit: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [stage, setStage] = useState("all");
  const [sort, setSort] = useState("newest");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const projectById = useMemo(() => new Map(projects.map(p => [p.id, p.name])), [projects]);
  const summary = useMemo(() => summarizeOperations(rows), [rows]);
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase().slice(0, 100);
    const visible = rows.filter(row => {
      if (category !== "all" && row.pipeline !== category) return false;
      if (stage === "attention" && !row.attention) return false;
      if (stage !== "all" && stage !== "attention" && row.state !== stage) return false;
      if (!query) return true;
      const haystack = [row.label, row.pipelineLabel, row.rawStatus, row.id,
        projectById.get(row.projectId) ?? ""].join(" ").toLowerCase();
      return haystack.includes(query);
    });
    if (sort === "oldest") visible.reverse();
    if (sort === "attention") visible.sort((a, b) =>
      Number(b.attention) - Number(a.attention) ||
      (b.ageSeconds ?? -1) - (a.ageSeconds ?? -1));
    return visible;
  }, [rows, category, stage, search, sort, projectById]);
  const liveJobs = summary.queued + summary.running;

  useEffect(() => {
    if (!autoRefresh || liveJobs === 0) return;
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 30000);
    return () => window.clearInterval(interval);
  }, [autoRefresh, liveJobs, router]);

  function selectProject(projectId: string) {
    const suffix = projectId ? "?project_id=" + encodeURIComponent(projectId) : "";
    startTransition(() => router.push("/dashboard/operations" + suffix));
  }

  return (
    <div className={styles.board}>
      <section className={styles.summaryPanel} aria-labelledby="operations-overview">
        <div className={styles.sectionHeading}>
          <div>
            <div className={styles.eyebrow}>Authenticated snapshot</div>
            <h2 id="operations-overview">Pipeline overview</h2>
          </div>
          <div className={styles.snapshotMeta}>
            <span>Updated {stamp(snapshotAt)}</span>
            <button type="button" onClick={() => startTransition(() => router.refresh())}
              disabled={pending} aria-label="Refresh research operations data">
              {pending ? "Refreshing…" : "↻ Refresh now"}
            </button>
          </div>
        </div>
        <div className={styles.metricGrid}>
          <div className={styles.metric}><span>Recent visible jobs</span><strong>{summary.visible}</strong></div>
          <div className={styles.metric}><span>Queued / running</span><strong>{liveJobs}</strong></div>
          <div className={styles.metric}><span>Need review</span><strong>{summary.attention}</strong></div>
          <div className={styles.metric}><span>Awaiting approval</span><strong>{summary.needsAction}</strong></div>
          <div className={styles.metric}><span>Completed</span><strong>{summary.completed}</strong></div>
        </div>
        <div className={styles.breakdown} aria-label="Distribution of visible job states">
          {(["completed", "running", "queued", "needsAction", "failed", "cancelled", "unknown"] as const)
            .map(key => {
              const value = summary[key];
              if (value === 0) return null;
              return <span key={key} title={key + ": " + value}
                style={{ width: (value / Math.max(1, summary.visible) * 100) + "%" }}
                className={styles["bar_" + key]} />;
            })}
        </div>
        <div className={styles.legend}>
          <span>{sourcesLoaded}/9 data sources available</span>
          <span>Latest {perPipelineLimit} records per pipeline (maximum)</span>
          <span>{autoRefresh && liveJobs ? "Auto-refresh: every 30s while visible" : "Auto-refresh inactive"}</span>
        </div>
        {missingSources.length ? (
          <p className={styles.warning} role="alert">
            <strong>Incomplete snapshot.</strong> These pipelines were unavailable: {missingSources.map(p => categoryNames[p]).join(", ")}.
            Counts must not be treated as overall workspace totals.
          </p>
        ) : null}
        <div className={styles.healthNote}>
          A job needs review if it reports a failure, has an unknown state, has queued for more than five minutes,
          or has been active for more than fifteen minutes. These are advisory thresholds, not proof of a stuck job.
          Completion counts reflect only the bounded recent snapshot.
        </div>
      </section>

      <section className={styles.listPanel} aria-labelledby="activity-heading">
        <div className={styles.sectionHeading}>
          <div><div className={styles.eyebrow}>Traceable job activity</div><h2 id="activity-heading">Research execution log</h2></div>
          <label className={styles.autoRefresh}><input type="checkbox" checked={autoRefresh}
            onChange={e => setAutoRefresh(e.target.checked)} /> Auto-refresh active jobs</label>
        </div>
        <div className={styles.filters}>
          <label>Project
            <select value={selectedProjectId} onChange={e => selectProject(e.target.value)} disabled={pending}>
              <option value="">All accessible projects</option>
              {projects.map(project => <option value={project.id} key={project.id}>{project.name}</option>)}
            </select>
          </label>
          <label>Pipeline
            <select value={category} onChange={e => setCategory(e.target.value)}>
              <option value="all">All pipelines</option>
              {PIPELINES.map(p => <option value={p} key={p}>{categoryNames[p]}</option>)}
            </select>
          </label>
          <label>Status
            <select value={stage} onChange={e => setStage(e.target.value)}>
              {filterOptions.map(o => <option key={o.value} value={o.value}>{o.text}</option>)}
            </select>
          </label>
          <label>Order
            <select value={sort} onChange={e => setSort(e.target.value)}>
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="attention">Needs review first</option>
            </select>
          </label>
          <label className={styles.searchLabel}>Search
            <input type="search" value={search} onChange={e => setSearch(e.target.value)}
              maxLength={100} placeholder="Job ID, type, accession, project…" />
          </label>
        </div>

        <div className={styles.resultHeader}>
          <strong>{filtered.length} matching records</strong>
          <span>Read-only monitoring · authorized projects only</span>
        </div>
        <div className={styles.entries}>
          {filtered.map(row => (
            <article key={row.pipeline + ":" + row.id} className={styles.entry}>
              <div className={styles.entryTop}>
                <div>
                  <span className={styles.pipeline}>{categoryNames[row.pipeline]}</span>
                  <h3>{row.label}</h3>
                  <span className={styles.project}>{projectById.get(row.projectId) ?? "Authorized project"}</span>
                </div>
                <div className={styles.entryStatus}>
                  <span className={styles["state_" + row.state]}>{stateNames[row.state]}</span>
                  {row.attention ? <strong className={styles.attention}>Review needed</strong> : null}
                </div>
              </div>
              <div className={styles.entryMeta}>
                <span>Created {stamp(row.createdAt)}</span>
                <span>Status: {row.rawStatus.replaceAll("_", " ")}</span>
                <span>Age: {age(row.ageSeconds)}</span>
                {row.attempts !== null ? <span>Attempts: {row.attempts}</span> : null}
              </div>
              {row.attentionReason ? <p className={styles.reason}>{row.attentionReason}</p> : null}
              <div className={styles.entryFoot}>
                <code>{row.id}</code>
                {row.href ? <Link href={row.href}>Open {row.pipeline.startsWith("ai_") ? "conversation" : "record"} →</Link> :
                  <span className={styles.muted}>No direct record page available</span>}
              </div>
            </article>
          ))}
          {!filtered.length ? (
            <div className={styles.empty}>
              <h3>No records match these filters</h3>
              <p>Try a different project, pipeline or status. Empty results can also mean no work has been queued in this limited recent snapshot.</p>
              <button type="button" onClick={() => { setSearch(""); setCategory("all"); setStage("all"); setSort("newest"); }}>
                Clear local filters
              </button>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
