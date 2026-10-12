import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { loadWorkflowDiagnostic } from "@/lib/workflow-evidence.server";
import { WorkflowAutoRefresh } from "./workflow-auto-refresh";
import styles from "./workflow.module.css";

export const dynamic = "force-dynamic";

function textStatus(value: string) {
  return value.replaceAll("_", " ");
}
function time(value: string | null) {
  if (!value) return "Not recorded";
  const stamp = Date.parse(value);
  return Number.isFinite(stamp) ? new Date(stamp).toLocaleString() : "Invalid timestamp";
}

export default async function WorkflowPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const outcome = await loadWorkflowDiagnostic(id);
  if (!outcome.ok) {
    if (outcome.status === 401) redirect("/login");
    if (outcome.status === 404) notFound();
    return (
      <main className="container dashboard">
        <section className="card">
          <div className="eyebrow">Research workflow</div>
          <h1>Workflow evidence unavailable</h1>
          <p>Secure workflow evidence could not be retrieved. No partial or unverified scientific status is displayed.</p>
          <Link className="button" href="/dashboard/operations">Return to operations</Link>
        </section>
      </main>
    );
  }
  const data = outcome.value;
  return (
    <main className={"container dashboard " + styles.screen}>
      <header className={styles.hero}>
        <div>
          <div className="eyebrow">Production scientific workflow · Reconciled evidence</div>
          <h1>MSA → Phylogenetic Analysis</h1>
          <p>{data.headline}. This view compares the authoritative workflow with both scientific jobs and their stored dependency metadata.</p>
          <div className={styles.identifier}>Workflow {data.workflowId}</div>
        </div>
        <div className={styles.heroLinks}>
          <Link className="button" href={"/dashboard/ai/" + data.conversationId}>Research conversation</Link>
          <Link className="button" href="/dashboard/operations">Operations center</Link>
        </div>
      </header>

      <section className={styles.panel}>
        <div className={styles.sectionHeader}>
          <div>
            <div className="eyebrow">Execution lifecycle</div>
            <h2>{data.headline}</h2>
            <p>Observed {time(data.observedAt)} · Workflow: {textStatus(data.state)}</p>
          </div>
          <WorkflowAutoRefresh enabled={data.refreshing} />
        </div>
        <div className={styles.stepGrid}>
          {data.stages.map((step, i) => (
            <article key={i} className={styles.step}>
              <div className={styles.stepTop}>
                <span className={styles.number}>{String(i + 1).padStart(2, "0")}</span>
                <span className={styles["state_" + step.state]}>{textStatus(step.state)}</span>
              </div>
              <h3>{step.title}</h3>
              <div className={styles.stepMeta}>
                <span>Scientific state: {step.rawStatus ? textStatus(step.rawStatus) : "Not available"}</span>
                <span>Attempts: {step.attempts ?? "—"}</span>
                <span>Created: {time(step.createdAt)}</span>
                <span>Started: {time(step.startedAt)}</span>
                <span>Finished: {time(step.finishedAt)}</span>
              </div>
              {step.resultSha256 ? (
                <div className={styles.hash}>
                  <small>Recorded result SHA-256</small>
                  <code>{step.resultSha256}</code>
                </div>
              ) : null}
              {step.href ? <Link className={styles.stepLink} href={step.href}>Open scientific job →</Link> : null}
            </article>
          ))}
        </div>
        <p className={styles.caveat}>Step 2 is automatically dispatched by the existing database workflow trigger, only after successful MSA completion. The diagram represents processing order; it does not claim the scientific topology is rooted.</p>
      </section>

      <section className={styles.panel}>
        <div className={styles.sectionHeader}>
          <div><div className="eyebrow">Evidence integrity</div><h2>Dependency lineage & recovery diagnostics</h2></div>
          <span className={styles.lineage}>{data.lineage === "verified_metadata" ? "Recorded lineage matches"
            : data.lineage === "pending" ? "Handoff pending" : data.lineage === "mismatch" ? "Lineage mismatch" : "Dependency unavailable"}</span>
        </div>
        <p className={styles.caveat}>The source MSA result hash is compared with the phylogenetic dependency hash. This is a metadata consistency check, not a fresh download or independent rehash of storage bytes. The scientific result page provides separately SHA-256-verified downloads.</p>
        {data.findings.length ? (
          <div className={styles.findings}>
            {data.findings.map(f => (
              <article className={styles.finding} key={f.code}>
                <div><span className={styles.severity}>{f.severity}</span><strong>{f.title}</strong></div>
                <p>{f.guidance}</p>
              </article>
            ))}
          </div>
        ) : (
          <div className={styles.clear}>
            No cross-step inconsistencies detected in the currently authorized metadata.
            {data.state === "running" ? " The scientific worker may still be processing." : ""}
          </div>
        )}
        <div className={styles.actions}>
          <a className="button" href={"/dashboard/workflows/" + data.workflowId + "/diagnostic"} download>Export diagnostic JSON</a>
          <Link className="button" href={"/dashboard/operations?project_id=" + data.projectId}>Inspect project operations</Link>
        </div>
        <p className={styles.caveat}>Recovery is intentionally non-destructive. This page will not restart, cancel, replay or alter a scientific job. Investigate queue health and audit records before authorizing a new job; automatic retries without validated idempotency could duplicate computation.</p>
      </section>
    </main>
  );
}
