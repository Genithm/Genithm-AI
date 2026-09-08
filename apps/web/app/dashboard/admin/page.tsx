import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/report-database.types";

type Overview = {
  schema_version?: string;
  checked_at?: string;
  accounts?: Record<string, number>;
  scientific_resources?: Record<string, number>;
  ai_resources?: Record<string, number>;
  audit_event_count?: number;
  workers?: {
    expected?: number;
    fresh?: number;
    missing_or_stale?: number;
    stale_after_seconds?: number;
  };
  status_counts?: Record<string, Record<string, number>>;
};

function asOverview(value: Json | null): Overview {
  if (!value || Array.isArray(value) || typeof value !== "object") return {};
  return value as Overview;
}

function metricCards(metrics: Record<string, number> | undefined) {
  if (!metrics) return <div className="notice">No aggregate metrics are available.</div>;
  return (
    <div className="list">
      {Object.entries(metrics).map(([key, value]) => (
        <div className="item" key={key}>
          <strong>{key.replaceAll("_", " ")}</strong>
          <div className="small">{value.toLocaleString()}</div>
        </div>
      ))}
    </div>
  );
}

export default async function PlatformAdminPage() {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (!claimsData?.claims?.sub) redirect("/login");

  const { data: isPlatformAdmin, error: entitlementError } = await supabase.rpc("is_platform_admin");
  if (entitlementError || !isPlatformAdmin) notFound();

  const [overviewResult, organizationsResult] = await Promise.all([
    supabase.rpc("get_platform_admin_overview"),
    supabase.rpc("get_platform_admin_organizations", { page_size: 50, page_offset: 0 }),
  ]);

  const overview = asOverview(overviewResult.data);
  const workers = overview.workers ?? {};

  return (
    <main className="container dashboard">
      <header className="dashboard-header">
        <div>
          <div className="eyebrow">Internal control plane</div>
          <h2>Platform admin</h2>
          <p className="small">
            Read-only operational visibility across Genithm. This surface intentionally excludes user emails,
            sequences, prompts, result bodies, and destructive controls.
          </p>
        </div>
        <Link className="button" href="/dashboard">Back to dashboard</Link>
      </header>

      {overviewResult.error ? <div className="error">Platform overview could not be loaded.</div> : null}
      {organizationsResult.error ? <div className="error">Organization summaries could not be loaded.</div> : null}

      <section className="card">
        <div className="eyebrow">Access boundary</div>
        <h3>Operator-managed entitlement</h3>
        <p className="small">
          Platform admin access is stored in a private database registry. It is not derived from user-editable
          profile metadata and cannot be self-granted from the browser.
        </p>
      </section>

      <section className="card" style={{ marginTop: 18 }}>
        <div className="eyebrow">Accounts</div>
        <h3>Tenant footprint</h3>
        {metricCards(overview.accounts)}
      </section>

      <section className="card" style={{ marginTop: 18 }}>
        <div className="eyebrow">Scientific resources</div>
        <h3>Recorded workload</h3>
        {metricCards(overview.scientific_resources)}
      </section>

      <section className="card" style={{ marginTop: 18 }}>
        <div className="eyebrow">AI resources</div>
        <h3>Recorded AI workload</h3>
        {metricCards(overview.ai_resources)}
      </section>

      <section className="card" style={{ marginTop: 18 }}>
        <div className="eyebrow">Worker liveness</div>
        <h3>{workers.fresh ?? 0} of {workers.expected ?? 6} workers fresh</h3>
        <p className="small">
          Missing or stale: {workers.missing_or_stale ?? 6}. Freshness threshold: {workers.stale_after_seconds ?? 300}s.
        </p>
      </section>

      <section className="card" style={{ marginTop: 18 }}>
        <div className="eyebrow">Audit</div>
        <h3>{(overview.audit_event_count ?? 0).toLocaleString()} audit events</h3>
        <p className="small">Only the aggregate event count is shown here; event payloads remain outside this admin surface.</p>
      </section>

      <section className="card" style={{ marginTop: 18 }}>
        <div className="eyebrow">Organizations</div>
        <h3>Bounded tenant summary</h3>
        <p className="small">Showing up to 50 organizations. Member identities and scientific content are not included.</p>
        <div className="list">
          {(organizationsResult.data ?? []).map((organization) => (
            <div className="item" key={organization.organization_id}>
              <strong>{organization.organization_name}</strong>
              <div className="small">/{organization.organization_slug}</div>
              <div className="small">
                {Number(organization.member_count).toLocaleString()} members · {Number(organization.project_count).toLocaleString()} projects
              </div>
              <div className="small">Created {new Date(organization.created_at).toLocaleString()}</div>
            </div>
          ))}
          {!(organizationsResult.data ?? []).length ? <div className="notice">No organizations recorded.</div> : null}
        </div>
      </section>

      <section className="card" style={{ marginTop: 18 }}>
        <div className="eyebrow">Status distributions</div>
        <h3>Operational state counts</h3>
        <div className="list">
          {Object.entries(overview.status_counts ?? {}).map(([resource, counts]) => (
            <div className="item" key={resource}>
              <strong>{resource.replaceAll("_", " ")}</strong>
              <div className="small">
                {Object.entries(counts).length
                  ? Object.entries(counts).map(([status, count]) => `${status}: ${count}`).join(" · ")
                  : "No rows"}
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
