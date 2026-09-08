import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import type { Json } from "@/lib/report-database.types";
import { createClient } from "@/lib/supabase/server";

type PlanDistribution = {
  plan_key: string;
  plan_name: string;
  plan_status: string;
  billing_model: string;
  organization_count: number;
};

type AdminBillingOverview = {
  active_plan_count?: number;
  subscription_count?: number;
  organizations_with_usage?: number;
  usage_event_count?: number;
  subscriptions_by_status?: Record<string, number>;
  subscriptions_by_plan?: PlanDistribution[];
};

type CatalogEntitlement = {
  feature_key: string;
  name: string;
  feature_status: string;
  enabled: boolean;
};

type CatalogLimit = {
  metric_key: string;
  name: string;
  unit: string;
  metering_state: string;
  reset_period: string;
  soft_limit: number | null;
  hard_limit: number | null;
};

type CatalogPrice = {
  price_key: string;
  currency: string;
  unit_amount_minor: number;
  billing_interval: string;
  interval_count: number;
  status: string;
};

type CatalogPlan = {
  plan_key: string;
  name: string;
  description: string;
  status: string;
  billing_model: string;
  entitlements: CatalogEntitlement[];
  limits: CatalogLimit[];
  prices: CatalogPrice[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asOverview(value: Json | null): AdminBillingOverview {
  if (!isRecord(value)) return {};
  const statusMap: Record<string, number> = {};
  if (isRecord(value.subscriptions_by_status)) {
    for (const [key, count] of Object.entries(value.subscriptions_by_status)) {
      if (typeof count === "number" && Number.isFinite(count)) statusMap[key] = count;
    }
  }

  const plans: PlanDistribution[] = [];
  const rawPlans: unknown[] = Array.isArray(value.subscriptions_by_plan) ? value.subscriptions_by_plan : [];
  for (const item of rawPlans) {
    if (!isRecord(item)) continue;
    if (typeof item.plan_key !== "string" || typeof item.plan_name !== "string" || typeof item.plan_status !== "string" || typeof item.billing_model !== "string" || typeof item.organization_count !== "number") continue;
    plans.push({
      plan_key: item.plan_key,
      plan_name: item.plan_name,
      plan_status: item.plan_status,
      billing_model: item.billing_model,
      organization_count: item.organization_count,
    });
  }

  return {
    active_plan_count: finiteNumber(value.active_plan_count) ?? undefined,
    subscription_count: finiteNumber(value.subscription_count) ?? undefined,
    organizations_with_usage: finiteNumber(value.organizations_with_usage) ?? undefined,
    usage_event_count: finiteNumber(value.usage_event_count) ?? undefined,
    subscriptions_by_status: statusMap,
    subscriptions_by_plan: plans,
  };
}

function asCatalog(value: Json | null): CatalogPlan[] {
  if (!isRecord(value) || !Array.isArray(value.plans)) return [];
  const plans: CatalogPlan[] = [];

  for (const rawPlan of value.plans as unknown[]) {
    if (!isRecord(rawPlan) || typeof rawPlan.plan_key !== "string" || typeof rawPlan.name !== "string") continue;

    const entitlements: CatalogEntitlement[] = [];
    for (const raw of Array.isArray(rawPlan.entitlements) ? (rawPlan.entitlements as unknown[]) : []) {
      if (!isRecord(raw) || typeof raw.feature_key !== "string" || typeof raw.name !== "string") continue;
      entitlements.push({
        feature_key: raw.feature_key,
        name: raw.name,
        feature_status: typeof raw.feature_status === "string" ? raw.feature_status : "unknown",
        enabled: raw.enabled === true,
      });
    }

    const limits: CatalogLimit[] = [];
    for (const raw of Array.isArray(rawPlan.limits) ? (rawPlan.limits as unknown[]) : []) {
      if (!isRecord(raw) || typeof raw.metric_key !== "string" || typeof raw.name !== "string" || typeof raw.unit !== "string") continue;
      limits.push({
        metric_key: raw.metric_key,
        name: raw.name,
        unit: raw.unit,
        metering_state: typeof raw.metering_state === "string" ? raw.metering_state : "unknown",
        reset_period: typeof raw.reset_period === "string" ? raw.reset_period : "none",
        soft_limit: finiteNumber(raw.soft_limit),
        hard_limit: finiteNumber(raw.hard_limit),
      });
    }

    const prices: CatalogPrice[] = [];
    for (const raw of Array.isArray(rawPlan.prices) ? (rawPlan.prices as unknown[]) : []) {
      if (!isRecord(raw) || typeof raw.price_key !== "string" || typeof raw.currency !== "string" || typeof raw.billing_interval !== "string") continue;
      const amount = finiteNumber(raw.unit_amount_minor);
      const intervalCount = finiteNumber(raw.interval_count);
      if (amount === null || intervalCount === null) continue;
      prices.push({
        price_key: raw.price_key,
        currency: raw.currency,
        unit_amount_minor: amount,
        billing_interval: raw.billing_interval,
        interval_count: intervalCount,
        status: typeof raw.status === "string" ? raw.status : "unknown",
      });
    }

    plans.push({
      plan_key: rawPlan.plan_key,
      name: rawPlan.name,
      description: typeof rawPlan.description === "string" ? rawPlan.description : "",
      status: typeof rawPlan.status === "string" ? rawPlan.status : "unknown",
      billing_model: typeof rawPlan.billing_model === "string" ? rawPlan.billing_model : "unknown",
      entitlements,
      limits,
      prices,
    });
  }

  return plans;
}

export default async function PlatformAdminBillingPage() {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (!claimsData?.claims?.sub) redirect("/login");

  const { data: isPlatformAdmin, error: entitlementError } = await supabase.rpc("is_platform_admin");
  if (entitlementError || !isPlatformAdmin) notFound();

  const [{ data, error }, catalogResult] = await Promise.all([
    supabase.rpc("get_platform_admin_billing_overview"),
    supabase.rpc("get_platform_admin_plan_catalog"),
  ]);
  const overview = asOverview(data);
  const catalog = asCatalog(catalogResult.data);

  return (
    <main className="container dashboard">
      <header className="dashboard-header">
        <div>
          <div className="eyebrow">Internal control plane</div>
          <h2>Billing operations</h2>
          <p className="small">Aggregate plan, subscription, usage-ledger, and draft commercial catalog visibility. No payment instruments or provider secrets are exposed.</p>
        </div>
        <Link className="button" href="/dashboard/admin">Back to platform admin</Link>
      </header>

      {error || catalogResult.error ? <div className="error">Billing control-plane data could not be fully loaded.</div> : null}

      <div className="section-grid">
        <section className="card">
          <div className="eyebrow">Plan catalog</div>
          <h3>{catalog.length.toLocaleString()} defined plans</h3>
          <p className="small">{(overview.active_plan_count ?? 0).toLocaleString()} are currently active. Draft plans cannot become customer subscriptions through this UI.</p>
        </section>
        <section className="card">
          <div className="eyebrow">Subscriptions</div>
          <h3>{(overview.subscription_count ?? 0).toLocaleString()} organizations assigned</h3>
          <p className="small">Operational entitlement state is not proof that payment has settled.</p>
        </section>
        <section className="card">
          <div className="eyebrow">Usage ledger</div>
          <h3>{(overview.usage_event_count ?? 0).toLocaleString()} usage events</h3>
          <p className="small">{(overview.organizations_with_usage ?? 0).toLocaleString()} organizations have recorded authoritative metering events.</p>
        </section>
      </div>

      <section className="card" style={{ marginTop: 18 }}>
        <div className="eyebrow">Commercial catalog</div>
        <h3>Provider-independent plan definitions</h3>
        <p className="small">Draft plan names follow the current product architecture. Prices and enforceable quotas remain intentionally unset until commercial and payment-provider review.</p>
        <div className="list">
          {catalog.map((plan) => {
            const enabledFeatures = plan.entitlements.filter((item) => item.enabled);
            const plannedFeatures = enabledFeatures.filter((item) => item.feature_status === "planned");
            const configuredHardLimits = plan.limits.filter((item) => item.hard_limit !== null);
            return (
              <div className="item" key={plan.plan_key}>
                <strong>{plan.name}</strong>
                <div className="small">{plan.plan_key} · {plan.billing_model} · {plan.status}</div>
                <p className="small">{plan.description}</p>
                <div className="small">Enabled entitlements: {enabledFeatures.length} · planned capabilities: {plannedFeatures.length}</div>
                <div className="small">Configured hard limits: {configuredHardLimits.length} · configured prices: {plan.prices.length}</div>
                {plannedFeatures.length ? <div className="small">Planned: {plannedFeatures.map((item) => item.name).join(", ")}</div> : null}
              </div>
            );
          })}
        </div>
      </section>

      <section className="card" style={{ marginTop: 18 }}>
        <div className="eyebrow">Plan distribution</div>
        <h3>Organizations by plan</h3>
        <div className="list">
          {(overview.subscriptions_by_plan ?? []).map((plan) => (
            <div className="item" key={plan.plan_key}>
              <strong>{plan.plan_name}</strong>
              <div className="small">{plan.plan_key} · {plan.billing_model} · {plan.plan_status}</div>
              <div>{plan.organization_count.toLocaleString()} organizations</div>
            </div>
          ))}
          {!(overview.subscriptions_by_plan ?? []).length ? <div className="notice">No plan distribution available.</div> : null}
        </div>
      </section>

      <section className="card" style={{ marginTop: 18 }}>
        <div className="eyebrow">Subscription states</div>
        <h3>Operational status counts</h3>
        <div className="list">
          {Object.entries(overview.subscriptions_by_status ?? {}).map(([status, count]) => (
            <div className="item" key={status}>
              <strong>{status.replaceAll("_", " ")}</strong>
              <div>{count.toLocaleString()}</div>
            </div>
          ))}
          {!Object.keys(overview.subscriptions_by_status ?? {}).length ? <div className="notice">No organization subscriptions yet.</div> : null}
        </div>
      </section>

      <section className="card" style={{ marginTop: 18 }}>
        <div className="eyebrow">Commercial boundary</div>
        <h3>Activation remains fail-closed</h3>
        <p className="small">Checkout, invoices, refunds, payment methods, provider webhooks, customer-paid plan assignment, price activation, and hard-quota activation remain outside this slice.</p>
      </section>
    </main>
  );
}
