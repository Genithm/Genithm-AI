import Link from "next/link";
import { redirect } from "next/navigation";

import type { Json } from "@/lib/report-database.types";
import { getStripeSetupState } from "@/lib/stripe-server";
import { createClient } from "@/lib/supabase/server";

type CheckoutOption = {
  price_key: string;
  plan_key: string;
  plan_name: string;
  currency: string;
  unit_amount_minor: number;
  billing_interval: string;
  interval_count: number;
};

type Invoice = {
  provider_invoice_id: string;
  status: string | null;
  currency: string;
  amount_due_minor: number;
  amount_paid_minor: number;
  amount_remaining_minor: number;
  hosted_invoice_url: string | null;
  invoice_pdf_url: string | null;
  provider_created_at: string | null;
};

type BillingState = {
  livemode: boolean;
  can_manage_billing: boolean;
  provider_customer_configured: boolean;
  provider_catalog_ready: boolean;
  subscription: {
    provider_status: string;
    cancel_at_period_end: boolean;
    current_period_start: string | null;
    current_period_end: string | null;
    cancel_at: string | null;
    provider_subscription_id: string;
    plan_name: string;
    plan_key: string;
    price_key: string;
  } | null;
  checkout_options: CheckoutOption[];
  recent_invoices: Invoice[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function asBillingState(value: Json | null): BillingState | null {
  if (!isRecord(value)) return null;
  const options: CheckoutOption[] = [];
  for (const raw of Array.isArray(value.checkout_options) ? value.checkout_options : []) {
    if (!isRecord(raw) || typeof raw.price_key !== "string" || typeof raw.plan_name !== "string" || typeof raw.currency !== "string") continue;
    options.push({
      price_key: raw.price_key,
      plan_key: typeof raw.plan_key === "string" ? raw.plan_key : "",
      plan_name: raw.plan_name,
      currency: raw.currency,
      unit_amount_minor: numberValue(raw.unit_amount_minor),
      billing_interval: typeof raw.billing_interval === "string" ? raw.billing_interval : "month",
      interval_count: numberValue(raw.interval_count) || 1,
    });
  }
  const invoices: Invoice[] = [];
  for (const raw of Array.isArray(value.recent_invoices) ? value.recent_invoices : []) {
    if (!isRecord(raw) || typeof raw.provider_invoice_id !== "string" || typeof raw.currency !== "string") continue;
    invoices.push({
      provider_invoice_id: raw.provider_invoice_id,
      status: typeof raw.status === "string" ? raw.status : null,
      currency: raw.currency,
      amount_due_minor: numberValue(raw.amount_due_minor),
      amount_paid_minor: numberValue(raw.amount_paid_minor),
      amount_remaining_minor: numberValue(raw.amount_remaining_minor),
      hosted_invoice_url: typeof raw.hosted_invoice_url === "string" ? raw.hosted_invoice_url : null,
      invoice_pdf_url: typeof raw.invoice_pdf_url === "string" ? raw.invoice_pdf_url : null,
      provider_created_at: typeof raw.provider_created_at === "string" ? raw.provider_created_at : null,
    });
  }
  const sub = isRecord(value.subscription) ? value.subscription : null;
  return {
    livemode: value.livemode === true,
    can_manage_billing: value.can_manage_billing === true,
    provider_customer_configured: value.provider_customer_configured === true,
    provider_catalog_ready: value.provider_catalog_ready === true,
    subscription: sub && typeof sub.provider_subscription_id === "string" ? {
      provider_status: typeof sub.provider_status === "string" ? sub.provider_status : "unknown",
      cancel_at_period_end: sub.cancel_at_period_end === true,
      current_period_start: typeof sub.current_period_start === "string" ? sub.current_period_start : null,
      current_period_end: typeof sub.current_period_end === "string" ? sub.current_period_end : null,
      cancel_at: typeof sub.cancel_at === "string" ? sub.cancel_at : null,
      provider_subscription_id: sub.provider_subscription_id,
      plan_name: typeof sub.plan_name === "string" ? sub.plan_name : "Unknown plan",
      plan_key: typeof sub.plan_key === "string" ? sub.plan_key : "",
      price_key: typeof sub.price_key === "string" ? sub.price_key : "",
    } : null,
    checkout_options: options,
    recent_invoices: invoices,
  };
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
  return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleString();
}

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<{ organization?: string; checkout?: string }> }) {
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

  const setup = getStripeSetupState();
  const billingResult = selected
    ? await supabase.rpc("get_organization_billing_state", { organization_id: selected.id, livemode: setup.livemode })
    : { data: null, error: null };
  const state = asBillingState(billingResult.data);
  const providerReady = setup.secretKeyConfigured && setup.webhookSecretConfigured;

  return (
    <main className="container dashboard">
      <header className="dashboard-header">
        <div>
          <div className="eyebrow">Organization billing</div>
          <h2>Payments</h2>
          <p className="small">Stripe-hosted checkout and billing management. Genithm never stores card or bank-account details.</p>
        </div>
        <div className="actions">
          <Link className="button" href="/dashboard/billing">Plan & usage</Link>
          <Link className="button" href="/dashboard">Dashboard</Link>
        </div>
      </header>

      {organizationsError ? <div className="error">Organizations could not be loaded.</div> : null}
      {query.checkout === "success" ? <div className="notice">Checkout completed. Subscription state will reconcile through Stripe webhooks.</div> : null}
      {query.checkout === "cancelled" ? <div className="notice">Checkout was cancelled; no Genithm plan change was applied.</div> : null}

      <section className="card">
        <div className="eyebrow">Provider readiness</div>
        <h3>Stripe {setup.livemode ? "live" : "test"} mode</h3>
        <div className="small">Secret key: {setup.secretKeyConfigured ? "configured" : "missing"} · webhook signing secret: {setup.webhookSecretConfigured ? "configured" : "missing"}</div>
        <div className="small">Price catalog: {state?.provider_catalog_ready ? "ready" : "not mapped yet"} · customer: {state?.provider_customer_configured ? "created" : "created automatically at first checkout"}</div>
        {!providerReady ? <div className="notice" style={{ marginTop: 10 }}>Payments stay disabled until both server-side Stripe credentials are attached. No secret belongs in browser variables.</div> : null}
      </section>

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

      {billingResult.error ? <div className="error" style={{ marginTop: 18 }}>Payment state could not be loaded.</div> : null}
      {selected && state ? (
        <>
          <section className="card" style={{ marginTop: 18 }}>
            <div className="eyebrow">Subscription</div>
            {state.subscription ? (
              <>
                <h3>{state.subscription.plan_name}</h3>
                <div className="small">Status: {state.subscription.provider_status} · current period ends: {formatDate(state.subscription.current_period_end)}</div>
                {state.subscription.cancel_at_period_end ? <div className="notice" style={{ marginTop: 8 }}>Cancellation is scheduled for the end of the current billing period.</div> : null}
                {state.can_manage_billing && providerReady ? (
                  <form action="/api/billing/portal" method="post" style={{ marginTop: 12 }}>
                    <input type="hidden" name="organizationId" value={selected.id} />
                    <button className="button" type="submit">Manage subscription, payment methods & invoices</button>
                  </form>
                ) : null}
              </>
            ) : (
              <>
                <h3>No paid subscription</h3>
                <p className="small">Choose an available plan below when the commercial catalog is activated.</p>
              </>
            )}
          </section>

          {!state.subscription ? (
            <section className="card" style={{ marginTop: 18 }}>
              <div className="eyebrow">Checkout</div>
              <h3>Available plans</h3>
              <div className="list">
                {state.checkout_options.map((option) => (
                  <div className="item" key={option.price_key}>
                    <strong>{option.plan_name}</strong>
                    <div className="small">{formatMoney(option.unit_amount_minor, option.currency)} / {option.interval_count === 1 ? option.billing_interval : `${option.interval_count} ${option.billing_interval}s`}</div>
                    {state.can_manage_billing && providerReady ? (
                      <form action="/api/billing/checkout" method="post" style={{ marginTop: 8 }}>
                        <input type="hidden" name="organizationId" value={selected.id} />
                        <input type="hidden" name="priceKey" value={option.price_key} />
                        <button className="button" type="submit">Continue to secure checkout</button>
                      </form>
                    ) : null}
                  </div>
                ))}
                {!state.checkout_options.length ? <div className="notice">No live commercial prices are mapped yet. Draft plans cannot accidentally accept payment.</div> : null}
              </div>
            </section>
          ) : null}

          <section className="card" style={{ marginTop: 18 }}>
            <div className="eyebrow">Invoices</div>
            <h3>Recent billing history</h3>
            <div className="list">
              {state.recent_invoices.map((invoice) => (
                <div className="item" key={invoice.provider_invoice_id}>
                  <strong>{formatMoney(invoice.amount_due_minor, invoice.currency)}</strong>
                  <div className="small">{invoice.status ?? "unknown"} · paid {formatMoney(invoice.amount_paid_minor, invoice.currency)} · {formatDate(invoice.provider_created_at)}</div>
                  <div className="actions" style={{ marginTop: 6 }}>
                    {invoice.hosted_invoice_url ? <a className="button" href={invoice.hosted_invoice_url} target="_blank" rel="noreferrer">View invoice</a> : null}
                    {invoice.invoice_pdf_url ? <a className="button" href={invoice.invoice_pdf_url} target="_blank" rel="noreferrer">PDF</a> : null}
                  </div>
                </div>
              ))}
              {!state.recent_invoices.length ? <div className="notice">No Stripe invoices recorded yet.</div> : null}
            </div>
          </section>
        </>
      ) : null}
    </main>
  );
}
