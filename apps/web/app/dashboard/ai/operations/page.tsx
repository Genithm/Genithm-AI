import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

type HealthRow = {
  organization_id: string;
  organization_name: string;
  visibility_scope: "organization" | "self";
  pipeline: "planner" | "interpretation" | "evidence_followup";
  queued_count: number;
  active_count: number;
  terminal_24h_count: number;
  error_24h_count: number;
  oldest_queued_seconds: number | null;
  oldest_active_seconds: number | null;
  max_attempts: number;
  health: "healthy" | "attention";
  refreshed_at: string;
};

type RpcResult = { data: HealthRow[] | null; error: { message: string } | null };

function duration(seconds: number | null) {
  if (seconds === null) return "—";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

function pipelineLabel(value: HealthRow["pipeline"]) {
  if (value === "planner") return "Planner queue";
  if (value === "interpretation") return "Interpretation queue";
  return "Evidence follow-up queue";
}

export default async function AiOperationsPage({ searchParams }: { searchParams: Promise<{ project_id?: string }> }) {
  const query = await searchParams;
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (!claimsData?.claims?.sub) redirect("/login");

  const projectId = query.project_id && /^[0-9a-f-]{36}$/i.test(query.project_id) ? query.project_id : null;
  const rpc = supabase.rpc as unknown as (name: string, args: { target_project_id: string | null }) => Promise<RpcResult>;
  const [{ data: healthRows, error }, { data: projects }] = await Promise.all([
    rpc("get_ai_operational_health", { target_project_id: projectId }),
    supabase.from("projects").select("id,name,status").eq("status", "active").order("name"),
  ]);

  const rows = healthRows ?? [];
  const grouped = new Map<string, HealthRow[]>();
  for (const row of rows) {
    const existing = grouped.get(row.organization_id) ?? [];
    existing.push(row);
    grouped.set(row.organization_id, existing);
  }

  const refreshedAt = rows[0]?.refreshed_at ?? null;
  const attentionCount = rows.filter((row) => row.health === "attention").length;

  return (
    <main className="container dashboard">
      <header className="dashboard-header">
        <div>
          <div className="eyebrow">Production observability</div>
          <h2>AI operational health</h2>
          <p className="small">Bounded lifecycle metrics only. No prompts, frozen evidence, AI answers, or scientific result bodies are exposed here.</p>
        </div>
        <div className="actions" style={{ marginTop: 0 }}>
          <Link className="button" href="/dashboard/ai">Back to Genithm AI</Link>
        </div>
      </header>

      {error ? <p className="error">Operational health could not be loaded: {error.message}</p> : null}

      <section className="card">
        <div className="dashboard-header">
          <div>
            <div className="eyebrow">Filter</div>
            <h3>Queue scope</h3>
          </div>
          <div className="small">Refreshed {refreshedAt ? new Date(refreshedAt).toLocaleString() : "now"}</div>
        </div>
        <form method="get" className="actions">
          <select className="select" name="project_id" defaultValue={projectId ?? ""}>
            <option value="">All accessible projects</option>
            {(projects ?? []).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
          <button className="button primary">Apply filter</button>
          {projectId ? <Link className="button" href="/dashboard/ai/operations">Clear</Link> : null}
        </form>
        <div className="notice" style={{ marginTop: 12 }}>
          Health threshold: queued over 5 minutes, active over 15 minutes, or any error in the last 24 hours is marked Attention. This page never retries or mutates a job automatically.
        </div>
      </section>

      <section className="card" style={{ marginTop: 18 }}>
        <div className="eyebrow">Current state</div>
        <h3>{attentionCount ? `${attentionCount} pipeline${attentionCount === 1 ? "" : "s"} need attention` : "All visible AI pipelines healthy"}</h3>
        {!rows.length && !error ? <div className="notice">No accessible AI operational metrics are available for this scope.</div> : null}
      </section>

      {Array.from(grouped.entries()).map(([organizationId, orgRows]) => (
        <section className="card" style={{ marginTop: 18 }} key={organizationId}>
          <div className="dashboard-header">
            <div>
              <div className="eyebrow">{orgRows[0].visibility_scope === "organization" ? "Organization-wide visibility" : "Your requests only"}</div>
              <h3>{orgRows[0].organization_name}</h3>
            </div>
            <span className="small">{orgRows.some((row) => row.health === "attention") ? "Attention" : "Healthy"}</span>
          </div>
          <div className="list">
            {orgRows.map((row) => (
              <div className="item" key={row.pipeline}>
                <div className="dashboard-header">
                  <div>
                    <strong>{pipelineLabel(row.pipeline)}</strong>
                    <div className="small">Status: {row.health === "attention" ? "Attention" : "Healthy"} · max attempts observed {row.max_attempts}</div>
                  </div>
                </div>
                <div className="small" style={{ marginTop: 8 }}>
                  Queued {row.queued_count} · active {row.active_count} · terminal last 24h {row.terminal_24h_count} · errors last 24h {row.error_24h_count}
                </div>
                <div className="small">Oldest queued {duration(row.oldest_queued_seconds)} · oldest active {duration(row.oldest_active_seconds)}</div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}
