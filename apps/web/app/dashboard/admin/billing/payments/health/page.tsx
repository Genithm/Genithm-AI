import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import type { Json } from "@/lib/report-database.types";
import { createClient } from "@/lib/supabase/server";

type Row = Record<string, unknown>;
type Health = {
  generated_at: string | null;
  healthy_count: number;
  warning_count: number;
  degraded_count: number;
  unconfigured_count: number;
  providers: Row[];
  recent_reconciliations: Row[];
};

function isRecord(value: unknown): value is Row {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function rows(value: unknown) { return Array.isArray(value) ? value.filter(isRecord) : []; }
function count(value: unknown) { return typeof value === "number" && Number.isFinite(value) ? value : 0; }
function text(row: Row, key: string) {
  const value = row[key];
  return value === null || value === undefined ? "—" : String(value);
}
function bool(row: Row, key: string) { return row[key] === true; }
function parseHealth(value: Json | null): Health {
  if (!isRecord(value)) return { generated_at: null, healthy_count: 0, warning_count: 0, degraded_count: 0, unconfigured_count: 0, providers: [], recent_reconciliations: [] };
  return {
    generated_at: typeof value.generated_at === "string" ? value.generated_at : null,
    healthy_count: count(value.healthy_count),
    warning_count: count(value.warning_count),
    degraded_count: count(value.degraded_count),
    unconfigured_count: count(value.unconfigured_count),
    providers: rows(value.providers),
    recent_reconciliations: rows(value.recent_reconciliations),
  };
}

export default async function ProviderHealthPage() {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (!claimsData?.claims?.sub) redirect("/login");
  const { data: isAdmin } = await supabase.rpc("is_platform_admin");
  if (!isAdmin) notFound();

  const { data, error } = await supabase.rpc("get_platform_admin_provider_health");
  const health = parseHealth(data);

  return (
    <main className="container dashboard">
      <header className="dashboard-header">
        <div>
          <div className="eyebrow">Payment reliability control plane</div>
          <h2>Provider health & reconciliation</h2>
          <p className="small">Provider credentials, webhook failures, stale sync state, subscription drift and Wise transfer freshness are evaluated without storing provider secrets or raw webhook payloads.</p>
        </div>
        <div className="actions">
          <Link className="button" href="/dashboard/admin/billing/payments">Payment operations</Link>
          <Link className="button" href="/dashboard/admin/billing/payments/setup">Provider setup</Link>
        </div>
      </header>

      {error ? <div className="error">Provider health state could not be loaded.</div> : null}

      <div className="section-grid">
        <section className="card"><div className="eyebrow">Healthy</div><h3>{health.healthy_count.toLocaleString()}</h3><div className="small">Verified and current with no unresolved drift.</div></section>
        <section className="card"><div className="eyebrow">Warnings</div><h3>{health.warning_count.toLocaleString()}</h3><div className="small">Usually stale verification or stale authoritative sync.</div></section>
        <section className="card"><div className="eyebrow">Degraded</div><h3>{health.degraded_count.toLocaleString()}</h3><div className="small">Failed webhooks, drift, failed reconciliation or degraded credentials.</div></section>
        <section className="card"><div className="eyebrow">Unconfigured</div><h3>{health.unconfigured_count.toLocaleString()}</h3><div className="small">Supported provider with no recorded verified connection.</div></section>
      </div>

      <section className="card" style={{ marginTop: 18 }}>
        <div className="eyebrow">Provider status</div>
        <div className="list">
          {health.providers.map((provider, index) => {
            const providerKey = text(provider, "provider_key");
            const mode = provider.livemode === null || provider.livemode === undefined ? "not configured" : bool(provider, "livemode") ? "live" : "test/sandbox";
            return (
              <div className="item" key={`${providerKey}-${mode}-${index}`}>
                <strong>{text(provider, "display_name")} · {text(provider, "health_status")}</strong>
                <div className="small">{mode} · connection {text(provider, "connection_status")} · last verified {text(provider, "last_verified_at")}</div>
                <div className="small">Unresolved webhooks {text(provider, "unresolved_failed_webhooks")} · stale subscriptions {text(provider, "stale_subscriptions")} · subscription drift {text(provider, "subscription_drift_count")}</div>
                <div className="small">In-flight transfers {text(provider, "inflight_transfers")} · stale transfers {text(provider, "stale_transfers")} · last reconciliation {text(provider, "last_reconciliation_status")}</div>
                {provider.livemode !== null && provider.livemode !== undefined ? (
                  <form action="/api/admin/billing/providers/reconcile" method="post" style={{ marginTop: 10 }}>
                    <input type="hidden" name="provider" value={providerKey} />
                    <button className="button" type="submit">Verify & reconcile {text(provider, "display_name")}</button>
                  </form>
                ) : (
                  <div className="small" style={{ marginTop: 10 }}>Attach and verify credentials from Provider setup before reconciliation.</div>
                )}
              </div>
            );
          })}
          {!health.providers.length ? <div className="notice">No payment providers are registered.</div> : null}
        </div>
      </section>

      <section className="card" style={{ marginTop: 18 }}>
        <div className="eyebrow">Recent reconciliation runs</div>
        <p className="small">Failed webhook records remain immutable history. A successful authoritative re-read marks older failures resolved instead of deleting or rewriting them.</p>
        <div className="list">
          {health.recent_reconciliations.map((run, index) => (
            <div className="item" key={`${text(run, "run_id")}-${index}`}>
              <strong>{text(run, "provider_key")} · {text(run, "status")}</strong>
              <div className="small">Targets {text(run, "target_count")} · succeeded {text(run, "success_count")} · failed {text(run, "failure_count")}</div>
              <div className="small">Started {text(run, "started_at")} · finished {text(run, "finished_at")} · error {text(run, "error_code")}</div>
            </div>
          ))}
          {!health.recent_reconciliations.length ? <div className="notice">No reconciliation runs recorded yet.</div> : null}
        </div>
      </section>

      <div className="small" style={{ marginTop: 18 }}>Health generated {health.generated_at ?? "—"}. Warning thresholds are intentionally conservative at 24 hours for provider verification and authoritative sync freshness.</div>
    </main>
  );
}
