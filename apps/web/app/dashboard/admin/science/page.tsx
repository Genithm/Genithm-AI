import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ScienceOperationsRefresh } from "@/components/science-operations-refresh";
import { readScienceOperationsOverview } from "@/lib/science-operations-server";
import { createClient } from "@/lib/supabase/server";
import styles from "./science.module.css";

export const dynamic = "force-dynamic";

function age(seconds: number | null): string {
  if (seconds === null) return "Not recorded";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86_400)}d`;
}

function nice(value: string) {
  return value.replaceAll("_", " ");
}

export default async function ScienceOperationsPage() {
  const user = await createClient();
  const { data: claims } = await user.auth.getClaims();
  if (!claims?.claims?.sub) redirect("/login");

  const { data: admin, error: entitlementError } = await user.rpc("is_platform_admin");
  if (entitlementError || admin !== true) notFound();

  // The user-session authorization above MUST complete before any
  // backend service-role call. No sensitive DB rows are displayed.
  const overview = await readScienceOperationsOverview();
  const { status, pipelineCounts } = overview;
  const ready = overview.acceptance === "eligible";

  return (
    <main className="container dashboard">
      <ScienceOperationsRefresh />
      <header className="dashboard-header">
        <div>
          <div className="eyebrow">Internal control plane / Science V29</div>
          <h2>Research operations</h2>
          <p className="small">Live, aggregate-only health for the existing Genithm scientific runtime. This page cannot launch jobs, restart workers, modify queues or grant research approval.</p>
        </div>
        <div className="actions">
          <Link className="button" href="/dashboard/admin">Platform admin</Link>
          <Link className="button" href="/dashboard/ai">Research chat</Link>
        </div>
      </header>

      <section className={styles.overview} aria-label="Science release state">
        <div className={styles.hero}>
          <div className="eyebrow">Research activation</div>
          <h3>{ready ? "Eligible for fixed science" : "New fixed science remains paused"}</h3>
          <p>{ready
            ? "The feature is configured, database capabilities are present, and the trusted worker/queue readiness report is healthy. Each request still requires authenticated, explicit approval."
            : "At least one release gate is unavailable or not ready. Ordinary chat and previously recorded research remain accessible; no status shown here is scientific evidence."}</p>
          {status.checkedAt ? <small>Database checked: {status.checkedAt}</small> :
            <small>Database observation unavailable or expired.</small>}
        </div>
        <div className={styles.gateList}>
          <div><span>Worker / queue health</span><strong>{status.health}</strong></div>
          <div><span>Science schema</span><strong>{overview.schemaReady ? "Available" : "Unavailable"}</strong></div>
          <div><span>Server research flag</span><strong>{overview.fixedResearchConfigured ? "Enabled" : "Disabled"}</strong></div>
          <div><span>New consent eligibility</span><strong>{overview.acceptance}</strong></div>
        </div>
      </section>

      <section className={styles.stats} aria-label="Bounded operational metrics">
        <article className={styles.metric}><span>Queued messages</span><strong>{status.totalQueuedMessages?.toLocaleString() ?? "Unknown"}</strong><small>Across nine expected PGMQ queues</small></article>
        <article className={styles.metric}><span>Oldest recorded worker heartbeat</span><strong>{age(status.oldestWorkerHeartbeatSeconds)}</strong><small>Readiness threshold {status.workerHeartbeatLimitSeconds}s</small></article>
        <article className={styles.metric}><span>Oldest queued message</span><strong>{age(status.oldestQueuedMessageSeconds)}</strong><small>Queue depth is not a job result</small></article>
      </section>

      {status.warnings.length ? <section className={styles.warnings} role="status" aria-label="Release blockers">
        <h3>Release blockers</h3>
        <ul>{status.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
      </section> : null}

      <div className={styles.split}>
        <section className={styles.panel}>
          <h3>Continuous workers</h3>
          <p className="small">A current heartbeat proves only recent contact, not successful scientific execution.</p>
          <div className={styles.rows}>
            {status.workers.map((worker) => (
              <div className={styles.statusRow} key={worker.kind}>
                <span>{nice(worker.kind)}</span>
                <strong className={worker.health === "heartbeat_current" ? styles.good : styles.warn}>{nice(worker.health)}</strong>
              </div>
            ))}
          </div>
        </section>
        <section className={styles.panel}>
          <h3>Durable queues</h3>
          <p className="small">Queue health is derived from non-payload metrics, not stored scientific inputs.</p>
          <div className={styles.rows}>
            {status.queues.map((queue) => (
              <div className={styles.statusRow} key={queue.kind}>
                <span>{nice(queue.kind)}</span>
                <strong className={queue.health === "normal" ? styles.good : styles.warn}>{nice(queue.health)}</strong>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className={styles.panel}>
        <h3>Research pipeline census</h3>
        <p className="small">Aggregate counts across the platform. No users, accessions, chat messages, source sequences, storage keys, or scientific outputs are exposed.</p>
        <div className={styles.counts}>
          {Object.entries(pipelineCounts).map(([state, count]) => (
            <div className={styles.count} key={state}>
              <span>{nice(state)}</span>
              <strong>{count === null ? "Unknown" : count.toLocaleString()}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.panel}>
        <h3>Deployment and recovery</h3>
        <p className="small">To resolve stale worker heartbeats, deploy all six digest-pinned worker images onto the authorized Oracle host, confirm two successive fresh heartbeats, then verify API readiness and a real consent-bound NCBI science journey. Image publishing in GitHub does not start Oracle containers.</p>
        <p className="small">The JSON diagnostic endpoint is <code>/api/admin/science/health</code>. It requires the same platform-admin entitlement and has no-store headers. It is not a public health probe.</p>
        <div className="actions">
          <a className="button" href="https://github.com/Genithm/Genithm-AI/issues/210" rel="noopener noreferrer" target="_blank">Worker deployment task</a>
          <a className="button" href="https://github.com/Genithm/Genithm-AI/blob/main/docs/deployment/ORACLE_V1.md" rel="noopener noreferrer" target="_blank">Oracle deployment guide</a>
        </div>
      </section>
    </main>
  );
}
