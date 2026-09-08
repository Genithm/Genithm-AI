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
  schema_version?: string;
  checked_at?: string;
  active_plan_count?: number;
  subscription_count?: number;
  organizations_with_usage?: number;
  usage_event_count?: number;
  subscriptions_by_status?: Record<string, number>;
  subscriptions_by_plan?: PlanDistribution[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
    schema_version: typeof value.schema_version === "string" ? value.schema_version : undefined,
    checked_at: typeof value.checked_at === "string" ? value.checked_at : undefined,
    active_plan_count: typeof value.active_plan_count === "number" ? value.active_plan_count : undefined,
    subscription_count: typeof value.subscription_count === "number" ? value.subscription_count : undefined,
    organizations_with_usage: typeof value.organizations_with_usage === "number" ? value.organizations_with_usage : undefined,
    usage_event_count: typeof value.usage_event_count === "number" ? value.usage_event_count : undefined,
    subscriptions_by_status: statusMap,
    subscriptions_by_plan: plans,
  };
}

export default async function PlatformAdminBillingPage() {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (!claimsData?.claims?.sub) redirect("/login");

  const { data: isPlatformAdmin, error: entitlementError } = await supabase.rpc("is_platform_admin");
  if (entitlementError || !isPlatformAdmin) notFound();

  const { data, error } = await supabase.rpc("get_platform_admin_billing_overview");
  const overview = asOverview(data);

  return (
    <main className="container dashboard">
      <header className="dashboard-header">
        <div>
          <div className="eyebrow">Internal control plane</div>
          <h2>Billing operations</h2>
          <p className="small">Aggregate plan, subscription, and usage-ledger visibility. No payment instruments, provider secrets, or customer scientific payloads are exposed.</p>
        </div>
        <Link className="button" href="/dashboard/admin">Back to platform admin</Link>
      </header>

      {error ? <div className="error">Billing overview could not be loaded.</div> : null}

      <div className="section-grid">
        <section className="card">
          <div className="eyebrow">Plan catalog</div>
          <h3>{(overview.active_plan_count ?? 0).toLocaleString()} active plans</h3>
          <p className="small">Only configured plan definitions are counted; payment-provider products are not represented until explicitly mapped.</p>
        </section>
        <section className="card">
          <div className="eyebrow">Subscriptions</div>
          <h3>{(overview.subscription_count ?? 0).toLocaleString()} organizations assigned</h3>
          <p className="small">Organization subscriptions are operational entitlement state, not proof that payment has settled.</p>
        </section>
        <section className="card">
          <div className="eyebrow">Usage ledger</div>
          <h3>{(overview.usage_event_count ?? 0).toLocaleString()} usage events</h3>
          <p className="small">{(overview.organizations_with_usage ?? 0).toLocaleString()} organizations have recorded metering events.</p>
        </section>
      </div>

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
        <h3>No payment mutation surface in V1</h3>
        <p className="small">Checkout, invoices, refunds, payment methods, provider webhooks, paid-plan assignment, and price management remain outside this foundation until a billing provider is connected and separately secured.</p>
      </section>
    </main>
  );
}
