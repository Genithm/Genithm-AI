import Link from "next/link";
import { redirect } from "next/navigation";

import { getPayPalSetupState } from "@/lib/paypal-server";
import { getStripeSetupState } from "@/lib/stripe-server";
import { createClient } from "@/lib/supabase/server";

type ProviderSubscription = {
  provider_key: string;
  external_subscription_id: string;
  provider_status: string;
  current_period_end: string | null;
  plan_name: string;
  plan_key: string;
  price_key: string;
};

type ProviderCheckoutOption = {
  provider_key: string;
  price_key: string;
  plan_name: string;
  currency: string;
  unit_amount_minor: number;
  billing_interval: string;
  interval_count: number;
};

type ProviderState = {
  can_manage_billing: boolean;
  subscriptions: ProviderSubscription[];
  checkout_options: ProviderCheckoutOption[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function num(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function parseProviderState(value: unknown): ProviderState {
  if (!isRecord(value)) return { can_manage_billing: false, subscriptions: [], checkout_options: [] };
  const subscriptions: ProviderSubscription[] = [];
  for (const raw of Array.isArray(value.subscriptions) ? value.subscriptions : []) {
    if (!isRecord(raw) || typeof raw.provider_key !== "string" || typeof raw.external_subscription_id !== "string") continue;
    subscriptions.push({
      provider_key: raw.provider_key,
      external_subscription_id: raw.external_subscription_id,
      provider_status: typeof raw.provider_status === "string" ? raw.provider_status : "unknown",
      current_period_end: typeof raw.current_period_end === "string" ? raw.current_period_end : null,
      plan_name: typeof raw.plan_name === "string" ? raw.plan_name : "Unknown plan",
      plan_key: typeof raw.plan_key === "string" ? raw.plan_key : "",
      price_key: typeof raw.price_key === "string" ? raw.price_key : "",
    });
  }
  const checkout_options: ProviderCheckoutOption[] = [];
  for (const raw of Array.isArray(value.checkout_options) ? value.checkout_options : []) {
    if (!isRecord(raw) || typeof raw.provider_key !== "string" || typeof raw.price_key !== "string" || typeof raw.currency !== "string") continue;
    checkout_options.push({
      provider_key: raw.provider_key,
      price_key: raw.price_key,
      plan_name: typeof raw.plan_name === "string" ? raw.plan_name : "Unknown plan",
      currency: raw.currency,
      unit_amount_minor: num(raw.unit_amount_minor),
      billing_interval: typeof raw.billing_interval === "string" ? raw.billing_interval : "month",
      interval_count: num(raw.interval_count) || 1,
    });
  }
  return { can_manage_billing: value.can_manage_billing === true, subscriptions, checkout_options };
}

function formatMoney(minor: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: currency.toUpperCase() }).format(minor / 100);
  } catch {
    return `${(minor / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

function formatDate(value: string | null) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? "—" : parsed.toLocaleString();
}

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<{ organization?: string; checkout?: string; paypal?: string; paypal_action?: string }> }) {
  const query = await searchParams;
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (!claimsData?.claims?.sub) redirect("/login");

  const { data: organizations, error: organizationsError } = await supabase
    .from("organizations")
    .select("id,name,slug")
    .order("created_at", { ascending: true });
  const requestedId = String(query.organization ?? "").trim();
  const selected = requestedId
    ? (organizations ?? []).find((organization) => organization.id === requestedId) ?? null
    : (organizations ?? [])[0] ?? null;

  const stripe = getStripeSetupState();
  const paypal = getPayPalSetupState();

  let testState = parseProviderState(null);
  let liveState = parseProviderState(null);
  if (selected) {
    const [testResult, liveResult] = await Promise.all([
      (supabase as any).rpc("get_organization_provider_billing_state", { organization_id: selected.id, livemode: false }),
      (supabase as any).rpc("get_organization_provider_billing_state", { organization_id: selected.id, livemode: true }),
    ]);
    testState = parseProviderState(testResult.data);
    liveState = parseProviderState(liveResult.data);
  }

  const stripeState = stripe.livemode ? liveState : testState;
  const paypalState = paypal.livemode ? liveState : testState;
  const subscriptions = [
    ...stripeState.subscriptions.filter((item) => item.provider_key === "stripe"),
    ...paypalState.subscriptions.filter((item) => item.provider_key === "paypal"),
  ];
  const checkoutOptions = [
    ...stripeState.checkout_options.filter((item) => item.provider_key === "stripe"),
    ...paypalState.checkout_options.filter((item) => item.provider_key === "paypal"),
  ];
  const canManage = stripeState.can_manage_billing || paypalState.can_manage_billing;

  return (
    <main className="container dashboard">
      <header className="dashboard-header">
        <div>
          <div className="eyebrow">Organization billing</div>
          <h2>Payments</h2>
          <p className="small">Choose an available payment provider. Genithm keeps plans and entitlements provider-neutral and never stores card or bank-account details.</p>
        </div>
        <div className="actions">
          <Link className="button" href="/dashboard/billing">Plan & usage</Link>
          <Link className="button" href="/dashboard">Dashboard</Link>
        </div>
      </header>

      {organizationsError ? <div className="error">Organizations could not be loaded.</div> : null}
      {query.checkout === "success" ? <div className="notice">Stripe checkout completed. Webhooks will reconcile the authoritative subscription state.</div> : null}
      {query.checkout === "cancelled" ? <div className="notice">Stripe checkout was cancelled; no paid-plan change was applied.</div> : null}
      {query.paypal === "approved" ? <div className="notice">PayPal approval returned successfully. PayPal webhooks will reconcile the subscription state.</div> : null}
      {query.paypal === "cancelled" ? <div className="notice">PayPal approval was cancelled; no paid-plan change was applied.</div> : null}
      {query.paypal_action ? <div className="notice">PayPal subscription action submitted: {query.paypal_action}.</div> : null}

      <div className="section-grid">
        <section className="card">
          <div className="eyebrow">Stripe</div>
          <h3>{stripe.secretKeyConfigured ? "Credentials attached" : "Not connected"}</h3>
          <div className="small">{stripe.livemode ? "Live" : "Test"} · checkout, Customer Portal, invoices, refunds and disputes.</div>
        </section>
        <section className="card">
          <div className="eyebrow">PayPal</div>
          <h3>{paypal.credentialsConfigured ? "Credentials attached" : "Not connected"}</h3>
          <div className="small">{paypal.livemode ? "Live" : "Sandbox"} · PayPal recurring subscription approval and webhook reconciliation.</div>
        </section>
      </div>

      {organizations?.length ? (
        <section className="card" style={{ marginTop: 18 }}>
          <div className="eyebrow">Organization</div>
          <h3>{selected?.name ?? "Select organization"}</h3>
          <div className="actions">
            {(organizations ?? []).map((organization) => (
              <Link key={organization.id} className="button" href={`/dashboard/billing/payments?organization=${encodeURIComponent(organization.id)}`}>{organization.name}</Link>
            ))}
          </div>
        </section>
      ) : <section className="card" style={{ marginTop: 18 }}><h3>No organization yet</h3></section>}

      {selected ? (
        <>
          <section className="card" style={{ marginTop: 18 }}>
            <div className="eyebrow">Subscription</div>
            {subscriptions.length ? subscriptions.map((subscription) => (
              <div className="item" key={`${subscription.provider_key}-${subscription.external_subscription_id}`}>
                <strong>{subscription.plan_name} via {subscription.provider_key === "paypal" ? "PayPal" : "Stripe"}</strong>
                <div className="small">Status: {subscription.provider_status} · period ends: {formatDate(subscription.current_period_end)}</div>
                {canManage && subscription.provider_key === "stripe" && stripe.secretKeyConfigured ? (
                  <form action="/api/billing/portal" method="post" style={{ marginTop: 8 }}>
                    <input type="hidden" name="organizationId" value={selected.id} />
                    <button className="button" type="submit">Open Stripe billing portal</button>
                  </form>
                ) : null}
                {canManage && subscription.provider_key === "paypal" && paypal.credentialsConfigured ? (
                  <form action="/api/billing/paypal/subscription" method="post" className="actions" style={{ marginTop: 8 }}>
                    <input type="hidden" name="organizationId" value={selected.id} />
                    <input type="hidden" name="subscriptionId" value={subscription.external_subscription_id} />
                    {subscription.provider_status.toUpperCase() === "SUSPENDED" ? <button className="button" name="action" value="activate" type="submit">Reactivate PayPal subscription</button> : null}
                    {!['CANCELLED','EXPIRED'].includes(subscription.provider_status.toUpperCase()) ? <button className="button" name="action" value="cancel" type="submit">Cancel PayPal subscription</button> : null}
                  </form>
                ) : null}
              </div>
            )) : <><h3>No paid subscription</h3><p className="small">Choose a configured provider and plan below.</p></>}
          </section>

          {!subscriptions.length ? (
            <section className="card" style={{ marginTop: 18 }}>
              <div className="eyebrow">Checkout providers</div>
              <h3>Available plans</h3>
              <div className="list">
                {checkoutOptions.map((option) => {
                  const isStripe = option.provider_key === "stripe";
                  const providerReady = isStripe ? stripe.secretKeyConfigured : paypal.credentialsConfigured;
                  return (
                    <div className="item" key={`${option.provider_key}-${option.price_key}`}>
                      <strong>{option.plan_name} · {isStripe ? "Stripe" : "PayPal"}</strong>
                      <div className="small">{formatMoney(option.unit_amount_minor, option.currency)} / {option.interval_count === 1 ? option.billing_interval : `${option.interval_count} ${option.billing_interval}s`}</div>
                      {canManage && providerReady ? (
                        <form action={isStripe ? "/api/billing/checkout" : "/api/billing/paypal/checkout"} method="post" style={{ marginTop: 8 }}>
                          <input type="hidden" name="organizationId" value={selected.id} />
                          <input type="hidden" name="priceKey" value={option.price_key} />
                          <button className="button" type="submit">Continue with {isStripe ? "Stripe" : "PayPal"}</button>
                        </form>
                      ) : null}
                    </div>
                  );
                })}
                {!checkoutOptions.length ? <div className="notice">No verified provider prices are active yet. Draft plans cannot accidentally accept payment.</div> : null}
              </div>
            </section>
          ) : null}
        </>
      ) : null}
    </main>
  );
}
