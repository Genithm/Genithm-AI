import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import type { Json } from "@/lib/report-database.types";
import { getStripeSetupState } from "@/lib/stripe-server";
import { createClient } from "@/lib/supabase/server";

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

function count(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function rows(value: unknown) {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

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
  const currency = typeof row.currency === "string" ? row.currency.toUpperCase() : "";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount / 100);
  } catch {
    return `${(amount / 100).toFixed(2)} ${currency}`;
  }
}

export default async function PaymentOperationsPage() {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (!claimsData?.claims?.sub) redirect("/login");
  const { data: isAdmin } = await supabase.rpc("is_platform_admin");
  if (!isAdmin) notFound();

  const setup = getStripeSetupState();
  const { data, error } = await supabase.rpc("get_platform_admin_payment_operations");
  const operations = asOperations(data);

  return (
    <main className="container dashboard">
      <header className="dashboard-header">
        <div>
          <div className="eyebrow">Internal financial control plane</div>
          <h2>Payment operations</h2>
          <p className="small">Stripe reconciliation, payouts, refunds and disputes. No card numbers, bank accounts, provider secrets or scientific payloads are exposed.</p>
        </div>
        <div className="actions">
          <Link className="button" href="/dashboard/admin/billing">Billing operations</Link>
          <Link className="button" href="/dashboard/admin">Platform admin</Link>
        </div>
      </header>

      {error ? <div className="error">Payment operations could not be loaded.</div> : null}

      <div className="section-grid">
        <section className="card">
          <div className="eyebrow">Provider</div>
          <h3>Stripe {setup.livemode ? "live" : "test"}</h3>
          <div className="small">Secret key {setup.secretKeyConfigured ? "configured" : "missing"} · webhook secret {setup.webhookSecretConfigured ? "configured" : "missing"}</div>
        </section>
        <section className="card">
          <div className="eyebrow">Webhook health</div>
          <h3>{operations.failed_event_count.toLocaleString()} failed events</h3>
          <div className="small">Failed events remain visible for provider retry/reconciliation.</div>
        </section>
        <section className="card">
          <div className="eyebrow">Financial exceptions</div>
          <h3>{operations.pending_refund_count.toLocaleString()} pending refunds</h3>
          <div className="small">{operations.open_dispute_count.toLocaleString()} open disputes.</div>
        </section>
      </div>

      <section className="card" style={{ marginTop: 18 }}>
        <div className="eyebrow">Refund</div>
        <h3>Issue an audited refund</h3>
        <p className="small">Requires platform-admin access plus MFA/AAL2. Full refund is used when amount is blank. Amount is entered in the invoice currency's minor units.</p>
        <form action="/api/admin/billing/refund" method="post" className="list" style={{ marginTop: 10 }}>
          <label className="item">Stripe invoice ID<input name="providerInvoiceId" placeholder="in_..." required /></label>
          <label className="item">Amount in minor units (optional)<input name="amountMinor" inputMode="numeric" placeholder="e.g. 2500" /></label>
          <label className="item">Reason<select name="reason" defaultValue="requested_by_customer"><option value="requested_by_customer">Requested by customer</option><option value="duplicate">Duplicate</option><option value="fraudulent">Fraudulent</option><option value="other">Other / internal</option></select></label>
          <button className="button" type="submit">Authorize & submit refund</button>
        </form>
      </section>

      <section className="card" style={{ marginTop: 18 }}>
        <div className="eyebrow">Payouts</div>
        <h3>Recent Stripe payouts</h3>
        <div className="list">
          {operations.latest_payouts.map((row, index) => <div className="item" key={`${field(row, "provider_payout_id")}-${index}`}><strong>{money(row)}</strong><div className="small">{field(row, "status")} · arrival {field(row, "arrival_date")} · {field(row, "livemode") === "true" ? "live" : "test"}</div><div className="small">{field(row, "provider_payout_id")}</div></div>)}
          {!operations.latest_payouts.length ? <div className="notice">No payout events recorded yet. Bank destination and payout schedule are configured only in Stripe.</div> : null}
        </div>
      </section>

      <section className="card" style={{ marginTop: 18 }}>
        <div className="eyebrow">Refunds</div>
        <h3>Recent refunds</h3>
        <div className="list">
          {operations.latest_refunds.map((row, index) => <div className="item" key={`${field(row, "refund_request_id")}-${index}`}><strong>{money(row)}</strong><div className="small">{field(row, "status")} · {field(row, "reason")} · invoice {field(row, "provider_invoice_id")}</div><div className="small">Org {field(row, "organization_id")}</div></div>)}
          {!operations.latest_refunds.length ? <div className="notice">No refunds recorded.</div> : null}
        </div>
      </section>

      <section className="card" style={{ marginTop: 18 }}>
        <div className="eyebrow">Disputes</div>
        <h3>Recent disputes</h3>
        <div className="list">
          {operations.latest_disputes.map((row, index) => <div className="item" key={`${field(row, "provider_dispute_id")}-${index}`}><strong>{money(row)}</strong><div className="small">{field(row, "status")} · {field(row, "reason")}</div><div className="small">Org {field(row, "organization_id")}</div></div>)}
          {!operations.latest_disputes.length ? <div className="notice">No disputes recorded.</div> : null}
        </div>
      </section>
    </main>
  );
}
