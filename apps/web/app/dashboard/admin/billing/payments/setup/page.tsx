import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { getPayPalSetupState } from "@/lib/paypal-server";
import { getStripeSetupState } from "@/lib/stripe-server";
import { createClient } from "@/lib/supabase/server";
import { getWiseSetupState } from "@/lib/wise-server";

function Status({ ready }: { ready: boolean }) {
  return <strong>{ready ? "Ready" : "Not configured"}</strong>;
}

export default async function PaymentSetupPage() {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (!claimsData?.claims?.sub) redirect("/login");
  const { data: isAdmin } = await supabase.rpc("is_platform_admin");
  if (!isAdmin) notFound();

  const stripe = getStripeSetupState();
  const paypal = getPayPalSetupState();
  const wise = getWiseSetupState();

  return (
    <main className="container dashboard">
      <header className="dashboard-header">
        <div>
          <div className="eyebrow">Payment onboarding</div>
          <h2>Payment provider setup</h2>
          <p className="small">Attach provider credentials once, verify them here, then use the same Genithm billing core across customer payments and payout rails.</p>
        </div>
        <div className="actions">
          <Link className="button" href="/dashboard/admin/billing/payments/health">Provider health</Link>
          <Link className="button" href="/dashboard/admin/billing/payments">Payment operations</Link>
          <Link className="button" href="/dashboard/admin/billing">Billing operations</Link>
        </div>
      </header>

      <div className="section-grid">
        <section className="card">
          <div className="eyebrow">Customer billing + payouts</div>
          <h3>Stripe · {stripe.livemode ? "live" : "test"}</h3>
          <div className="small">Secret key: <Status ready={stripe.secretKeyConfigured} /> · webhook: <Status ready={stripe.webhookSecretConfigured} /></div>
          <div className="small">Checkout, subscriptions, portal, invoices, refunds, disputes and payout status.</div>
          <form action="/api/admin/billing/providers/verify" method="post" style={{ marginTop: 10 }}>
            <input type="hidden" name="provider" value="stripe" />
            <button className="button" type="submit" disabled={!stripe.secretKeyConfigured}>Verify Stripe connection</button>
          </form>
        </section>

        <section className="card">
          <div className="eyebrow">Customer billing</div>
          <h3>PayPal · {paypal.livemode ? "live" : "sandbox"}</h3>
          <div className="small">Client credentials: <Status ready={paypal.credentialsConfigured} /> · webhook ID: <Status ready={paypal.webhookConfigured} /></div>
          <div className="small">Subscription checkout, recurring billing, payment events, refunds/disputes integration and webhook reconciliation.</div>
          <form action="/api/admin/billing/providers/verify" method="post" style={{ marginTop: 10 }}>
            <input type="hidden" name="provider" value="paypal" />
            <button className="button" type="submit" disabled={!paypal.credentialsConfigured}>Verify PayPal connection</button>
          </form>
        </section>

        <section className="card">
          <div className="eyebrow">Payout / transfer rail</div>
          <h3>Wise · {wise.livemode ? "live" : "sandbox"}</h3>
          <div className="small">API profile: <Status ready={wise.credentialsConfigured} /> · webhook public key: <Status ready={wise.webhookConfigured} /></div>
          <div className="small">International quotes, transfer preparation and signed transfer-status webhooks. Wise is not treated as a recurring SaaS checkout processor.</div>
          <form action="/api/admin/billing/providers/verify" method="post" style={{ marginTop: 10 }}>
            <input type="hidden" name="provider" value="wise" />
            <button className="button" type="submit" disabled={!wise.credentialsConfigured}>Verify Wise connection</button>
          </form>
        </section>
      </div>

      <section className="card" style={{ marginTop: 18 }}>
        <div className="eyebrow">Commercial subscription prices</div>
        <h3>Create & activate provider pricing</h3>
        <p className="small">MFA/AAL2 gated. Stripe creates Product + Price; PayPal creates Product + Billing Plan. The external IDs are mapped automatically to the same Genithm plan.</p>
        <form action="/api/admin/billing/configure-price" method="post" className="list" style={{ marginTop: 12 }}>
          <label className="item">Provider<select name="provider" defaultValue="stripe"><option value="stripe">Stripe</option><option value="paypal">PayPal</option></select></label>
          <label className="item">Plan<select name="planKey" defaultValue="researcher"><option value="researcher">Researcher</option><option value="professional">Professional</option><option value="team">Team</option></select></label>
          <label className="item">Billing interval<select name="interval" defaultValue="month"><option value="month">Monthly</option><option value="year">Yearly</option></select></label>
          <label className="item">Currency<input name="currency" defaultValue="USD" maxLength={3} required /></label>
          <label className="item">Amount in minor units<input name="amountMinor" inputMode="numeric" placeholder="e.g. 2900 = 29.00" required /></label>
          <button className="button" type="submit" disabled={!stripe.secretKeyConfigured && !paypal.credentialsConfigured}>Create provider price & activate plan</button>
        </form>
      </section>

      <section className="card" style={{ marginTop: 18 }}>
        <div className="eyebrow">One-time provider-side steps</div>
        <h3>Minimal external setup</h3>
        <ol className="small">
          <li><strong>Stripe:</strong> finish business verification/payout bank setup, create webhook `/api/billing/webhook`, enable Customer Portal.</li>
          <li><strong>PayPal:</strong> use a Business account/app, attach Client ID + Secret, register `/api/billing/paypal/webhook`, then attach its Webhook ID.</li>
          <li><strong>Wise:</strong> attach a Business/Platform API token + profile ID, register `/api/billing/wise/webhook`, and configure the Wise webhook RSA public key used for `X-Signature-SHA256` verification.</li>
          <li>Test providers in sandbox/test mode first; live credentials and live provider catalogs are configured separately.</li>
        </ol>
      </section>

      <section className="card" style={{ marginTop: 18 }}>
        <div className="eyebrow">Extensible provider contract</div>
        <p className="small">The database now stores provider capabilities and external identifiers generically. Additional processors such as Paddle, Adyen, Razorpay or other payout rails can be added as adapters without redesigning organization plans, usage metering or entitlement state.</p>
      </section>

      <section className="card" style={{ marginTop: 18 }}>
        <div className="eyebrow">Security boundary</div>
        <p className="small">Never paste secret keys, OAuth client secrets, API tokens, bank details or card data into Genithm forms or source control. Credentials belong only in the deployment secret manager. Genithm stores provider IDs/status/amount metadata, not raw financial instruments.</p>
      </section>
    </main>
  );
}
