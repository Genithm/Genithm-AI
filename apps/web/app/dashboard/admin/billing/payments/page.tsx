import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import type { Json } from "@/lib/report-database.types";
import { getPayPalSetupState } from "@/lib/paypal-server";
import { getStripeSetupState } from "@/lib/stripe-server";
import { createClient } from "@/lib/supabase/server";
import { getWiseSetupState } from "@/lib/wise-server";

type PaymentOperation = Record<string, unknown>;
type Operations = {
  failed_event_count: number;
  pending_refund_count: number;
  open_dispute_count: number;
  latest_payouts: PaymentOperation[];
  latest_refunds: PaymentOperation[];
  latest_disputes: PaymentOperation[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function count(value: unknown) { return typeof value === "number" && Number.isFinite(value) ? value : 0; }
function rows(value: unknown) { return Array.isArray(value) ? value.filter(isRecord) : []; }
function asOperations(value: Json | null): Operations {
  if (!isRecord(value)) return { failed_event_count: 0, pending_refund_count: 0, open_dispute_count: 0, latest_payouts: [], latest_refunds: [], latest_disputes: [] };
  return {
    failed_event_count: count(value.failed_event_count),
    pending_refund_count: count(value.pending_refund_count),
    open_dispute_count: count(value.open_dispute_count),
    latest_payouts: rows(value.latest_payouts),
    latest_refunds: rows(value.latest_refunds),
    latest_disputes: rows(value.latest_disputes),
  };
}
function field(row: PaymentOperation, key: string) {
  const value = row[key];
  return value === null || value === undefined ? "—" : String(value);
}
function money(row: PaymentOperation) {
  const amount = typeof row.amount_minor === "number" ? row.amount_minor : 0;
  const currency = typeof row.currency === "string" ? row.currency.toUpperCase() : "USD";
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount / 100); }
  catch { return `${(amount / 100).toFixed(2)} ${currency}`; }
}

export default async function PaymentOperationsPage() {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (!claimsData?.claims?.sub) redirect("/login");
  const { data: isAdmin } = await supabase.rpc("is_platform_admin");
  if (!isAdmin) notFound();

  const stripe = getStripeSetupState();
  const paypal = getPayPalSetupState();
  const wise = getWiseSetupState();
  const { data, error } = await supabase.rpc("get_platform_admin_payment_operations");
  const operations = asOperations(data);

  return (
    <main className="container dashboard">
      <header className="dashboard-header">
        <div>
          <div className="eyebrow">Internal financial control plane</div>
          <h2>Payment operations</h2>
          <p className="small">Stripe, PayPal and Wise are separated by capability. No card numbers, recipient bank details, provider secrets or scientific payloads are exposed.</p>
        </div>
        <div className="actions">
          <Link className="button" href="/dashboard/admin/billing/payments/setup">Provider setup</Link>
          <Link className="button" href="/dashboard/admin/billing">Billing operations</Link>
          <Link className="button" href="/dashboard/admin">Platform admin</Link>
        </div>
      </header>

      {error ? <div className="error">Legacy Stripe operational state could not be loaded.</div> : null}

      <div className="section-grid">
        <section className="card"><div className="eyebrow">Stripe</div><h3>{stripe.secretKeyConfigured ? "Attached" : "Missing credentials"}</h3><div className="small">{stripe.livemode ? "live" : "test"} · webhook {stripe.webhookSecretConfigured ? "ready" : "missing"}</div></section>
        <section className="card"><div className="eyebrow">PayPal</div><h3>{paypal.credentialsConfigured ? "Attached" : "Missing credentials"}</h3><div className="small">{paypal.livemode ? "live" : "sandbox"} · webhook ID {paypal.webhookConfigured ? "ready" : "missing"}</div></section>
        <section className="card"><div className="eyebrow">Wise</div><h3>{wise.credentialsConfigured ? "Attached" : "Missing credentials"}</h3><div className="small">{wise.livemode ? "live" : "sandbox"} · signed webhook key {wise.webhookConfigured ? "ready" : "missing"}</div></section>
      </div>

      <section className="card" style={{ marginTop: 18 }}>
        <div className="eyebrow">Wise payout rail</div>
        <h3>Prepare an international transfer</h3>
        <p className="small">Requires platform-admin MFA/AAL2. Genithm accepts an existing Wise recipient/account ID and never stores the recipient's raw bank details. Transfer funding remains subject to the permissions and region of the connected Wise account.</p>
        <form action="/api/admin/billing/wise/transfer" method="post" className="list" style={{ marginTop: 10 }}>
          <label className="item">Wise recipient/account ID<input name="targetAccount" required /></label>
          <label className="item">Source currency<input name="sourceCurrency" defaultValue="USD" maxLength={3} required /></label>
          <label className="item">Target currency<input name="targetCurrency" defaultValue="EUR" maxLength={3} required /></label>
          <label className="item">Source amount<input name="sourceAmount" inputMode="decimal" placeholder="100.00" required /></label>
          <label className="item">Reference (optional)<input name="reference" maxLength={70} /></label>
          <button className="button" type="submit" disabled={!wise.credentialsConfigured}>Create Wise quote & transfer instruction</button>
        </form>
      </section>

      <section className="card" style={{ marginTop: 18 }}>
        <div className="eyebrow">Stripe refund control</div>
        <h3>Issue an audited refund</h3>
        <p className="small">Requires platform-admin access plus MFA/AAL2. Full refund is used when amount is blank. Existing duplicate/cumulative over-refund protections remain active.</p>
        <form action="/api/admin/billing/refund" method="post" className="list" style={{ marginTop: 10 }}>
          <label className="item">Stripe invoice ID<input name="providerInvoiceId" placeholder="in_..." required /></label>
          <label className="item">Amount in minor units (optional)<input name="amountMinor" inputMode="numeric" placeholder="e.g. 2500" /></label>
          <label className="item">Reason<select name="reason" defaultValue="requested_by_customer"><option value="requested_by_customer">Requested by customer</option><option value="duplicate">Duplicate</option><option value="fraudulent">Fraudulent</option><option value="other">Other / internal</option></select></label>
          <button className="button" type="submit" disabled={!stripe.secretKeyConfigured}>Authorize & submit Stripe refund</button>
        </form>
      </section>

      <div className="section-grid" style={{ marginTop: 18 }}>
        <section className="card"><div className="eyebrow">Stripe webhook health</div><h3>{operations.failed_event_count.toLocaleString()} failed</h3><div className="small">Provider-neutral PayPal/Wise webhook ledgers are isolated from this legacy Stripe counter.</div></section>
        <section className="card"><div className="eyebrow">Stripe refunds</div><h3>{operations.pending_refund_count.toLocaleString()} pending</h3><div className="small">Audited admin refund requests.</div></section>
        <section className="card"><div className="eyebrow">Stripe disputes</div><h3>{operations.open_dispute_count.toLocaleString()} open</h3><div className="small">Current Stripe dispute exceptions.</div></section>
      </div>

      <section className="card" style={{ marginTop: 18 }}>
        <div className="eyebrow">Recent Stripe payouts</div>
        <div className="list">
          {operations.latest_payouts.map((row, index) => <div className="item" key={`${field(row, "provider_payout_id")}-${index}`}><strong>{money(row)}</strong><div className="small">{field(row, "status")} · arrival {field(row, "arrival_date")}</div></div>)}
          {!operations.latest_payouts.length ? <div className="notice">No Stripe payout events recorded yet.</div> : null}
        </div>
      </section>

      <section className="card" style={{ marginTop: 18 }}>
        <div className="eyebrow">Recent Stripe refunds</div>
        <div className="list">
          {operations.latest_refunds.map((row, index) => <div className="item" key={`${field(row, "refund_request_id")}-${index}`}><strong>{money(row)}</strong><div className="small">{field(row, "status")} · {field(row, "reason")} · invoice {field(row, "provider_invoice_id")}</div></div>)}
          {!operations.latest_refunds.length ? <div className="notice">No Stripe refunds recorded.</div> : null}
        </div>
      </section>
    </main>
  );
}
