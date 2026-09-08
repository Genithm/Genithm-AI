import Link from "next/link";
import { redirect } from "next/navigation";

import type { Json } from "@/lib/report-database.types";
import { createClient } from "@/lib/supabase/server";

type Entitlement = {
  feature_key: string;
  name: string;
  description: string;
  enabled: boolean;
};

type UsageLimit = {
  metric_key: string;
  name: string;
  unit: string;
  reset_period: string;
  aggregation_strategy: string;
  soft_limit: number | null;
  hard_limit: number | null;
  used: number;
  remaining: number | null;
  enforcement_active: boolean;
};

type PlanSummary = {
  organization_id: string;
  plan: {
    key: string;
    name: string;
    description: string;
    status: string;
    billing_model: string;
  };
  subscription: {
    status: string;
    assignment_source: string;
    current_period_start: string | null;
    current_period_end: string | null;
    cancel_at: string | null;
  };
  entitlements: Entitlement[];
  limits: UsageLimit[];
  commercial_enforcement_active: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asPlanSummary(value: Json | null): PlanSummary | null {
  if (!isRecord(value)) return null;
  const plan = value.plan;
  const subscription = value.subscription;
  if (!isRecord(plan) || !isRecord(subscription)) return null;
  if (typeof value.organization_id !== "string" || typeof plan.key !== "string" || typeof plan.name !== "string") return null;

  const entitlements: Entitlement[] = [];
  const rawEntitlements: unknown[] = Array.isArray(value.entitlements) ? value.entitlements : [];
  for (const item of rawEntitlements) {
    if (!isRecord(item)) continue;
    if (typeof item.feature_key !== "string" || typeof item.name !== "string" || typeof item.description !== "string" || typeof item.enabled !== "boolean") continue;
    entitlements.push({ feature_key: item.feature_key, name: item.name, description: item.description, enabled: item.enabled });
  }

  const limits: UsageLimit[] = [];
  const rawLimits: unknown[] = Array.isArray(value.limits) ? value.limits : [];
  for (const item of rawLimits) {
    if (!isRecord(item)) continue;
    if (typeof item.metric_key !== "string" || typeof item.name !== "string" || typeof item.unit !== "string") continue;
    limits.push({
      metric_key: item.metric_key,
      name: item.name,
      unit: item.unit,
      reset_period: typeof item.reset_period === "string" ? item.reset_period : "none",
      aggregation_strategy: typeof item.aggregation_strategy === "string" ? item.aggregation_strategy : "sum",
      soft_limit: numberOrNull(item.soft_limit),
      hard_limit: numberOrNull(item.hard_limit),
      used: numberOrNull(item.used) ?? 0,
      remaining: numberOrNull(item.remaining),
      enforcement_active: item.enforcement_active === true,
    });
  }

  return {
    organization_id: value.organization_id,
    plan: {
      key: plan.key,
      name: plan.name,
      description: typeof plan.description === "string" ? plan.description : "",
      status: typeof plan.status === "string" ? plan.status : "unknown",
      billing_model: typeof plan.billing_model === "string" ? plan.billing_model : "unknown",
    },
    subscription: {
      status: typeof subscription.status === "string" ? subscription.status : "unknown",
      assignment_source: typeof subscription.assignment_source === "string" ? subscription.assignment_source : "unknown",
      current_period_start: typeof subscription.current_period_start === "string" ? subscription.current_period_start : null,
      current_period_end: typeof subscription.current_period_end === "string" ? subscription.current_period_end : null,
      cancel_at: typeof subscription.cancel_at === "string" ? subscription.cancel_at : null,
    },
    entitlements,
    limits,
    commercial_enforcement_active: value.commercial_enforcement_active === true,
  };
}

function formatUsage(value: number, unit: string) {
  if (unit === "bytes") {
    if (value < 1024) return `${value.toLocaleString()} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
    if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
    return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
  }
  return `${value.toLocaleString()} ${unit}`;
}

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ organization?: string }> }) {
  const query = await searchParams;
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (!claimsData?.claims?.sub) redirect("/login");

  const { data: organizations, error: organizationsError } = await supabase
    .from("organizations")
    .select("id,name,slug")
    .order("created_at", { ascending: true });

  const requestedOrganizationId = String(query.organization ?? "").trim();
  const selectedOrganization = requestedOrganizationId
    ? (organizations ?? []).find((organization) => organization.id === requestedOrganizationId) ?? null
    : (organizations ?? [])[0] ?? null;

  const planResult = selectedOrganization
    ? await supabase.rpc("get_organization_plan_summary", { target_organization_id: selectedOrganization.id })
    : { data: null, error: null };
  const summary = asPlanSummary(planResult.data);

  return (
    <main className="container dashboard">
      <header className="dashboard-header">
        <div>
          <div className="eyebrow">Organization controls</div>
          <h2>Plan & usage</h2>
          <p className="small">Plan capabilities and usage are resolved by organization from the authoritative billing policy layer.</p>
        </div>
        <Link className="button" href="/dashboard">Back to research dashboard</Link>
      </header>

      {organizationsError ? <div className="error">Organizations could not be loaded.</div> : null}
      {!organizations?.length ? (
        <section className="card">
          <h3>No organization yet</h3>
          <p className="small">Create an organization from the research dashboard before plan state can be assigned.</p>
        </section>
      ) : (
        <>
          <section className="card">
            <div className="eyebrow">Organization</div>
            <h3>{selectedOrganization?.name ?? "Select organization"}</h3>
            <div className="actions">
              {(organizations ?? []).map((organization) => (
                <Link key={organization.id} className="button" href={`/dashboard/billing?organization=${encodeURIComponent(organization.id)}`}>
                  {organization.name}
                </Link>
              ))}
            </div>
          </section>

          {planResult.error ? <div className="error" style={{ marginTop: 18 }}>Plan state could not be loaded.</div> : null}
          {summary ? (
            <>
              <section className="card" style={{ marginTop: 18 }}>
                <div className="eyebrow">Current plan</div>
                <h2>{summary.plan.name}</h2>
                <p>{summary.plan.description}</p>
                <div className="small">Plan key: {summary.plan.key} · subscription: {summary.subscription.status} · assignment: {summary.subscription.assignment_source}</div>
                {summary.commercial_enforcement_active ? (
                  <div className="notice" style={{ marginTop: 10 }}>Configured hard limits are active for this organization.</div>
                ) : (
                  <div className="notice" style={{ marginTop: 10 }}>
                    Commercial quota enforcement is not active yet. Usage is visible, but no arbitrary launch-time cap is being applied.
                  </div>
                )}
              </section>

              <section className="card" style={{ marginTop: 18 }}>
                <div className="eyebrow">Entitlements</div>
                <h3>Enabled capabilities</h3>
                <div className="list">
                  {summary.entitlements.map((entitlement) => (
                    <div className="item" key={entitlement.feature_key}>
                      <strong>{entitlement.name}</strong>
                      <div className="small">{entitlement.enabled ? "Enabled" : "Disabled"} · {entitlement.feature_key}</div>
                      <p className="small">{entitlement.description}</p>
                    </div>
                  ))}
                </div>
              </section>

              <section className="card" style={{ marginTop: 18 }}>
                <div className="eyebrow">Usage ledger</div>
                <h3>Metered resources</h3>
                <p className="small">Usage events are written only by trusted backend services and are idempotent. Browser clients cannot write billing usage directly.</p>
                <div className="list">
                  {summary.limits.map((limit) => (
                    <div className="item" key={limit.metric_key}>
                      <strong>{limit.name}</strong>
                      <div className="small">Used: {formatUsage(limit.used, limit.unit)} · reset: {limit.reset_period}</div>
                      <div className="small">
                        {limit.hard_limit === null
                          ? "No hard limit configured"
                          : `Hard limit: ${formatUsage(limit.hard_limit, limit.unit)} · remaining: ${formatUsage(limit.remaining ?? 0, limit.unit)}`}
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="card" style={{ marginTop: 18 }}>
                <div className="eyebrow">Payment boundary</div>
                <h3>Provider not connected yet</h3>
                <p className="small">
                  This foundation deliberately does not show upgrade, checkout, invoice, or payment-method controls until a real billing provider and verified commercial plan catalog are connected.
                </p>
              </section>
            </>
          ) : null}
        </>
      )}
    </main>
  );
}
