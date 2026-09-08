import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { getStripeSetupState } from "@/lib/stripe-server";
import { createClient } from "@/lib/supabase/server";

export default async function PaymentSetupPage() {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (!claimsData?.claims?.sub) redirect("/login");
  const { data: isAdmin } = await supabase.rpc("is_platform_admin");
  if (!isAdmin) notFound();
  const setup = getStripeSetupState();

  return (
    <main className="container dashboard">
      <header className="dashboard-header">
        <div>
          <div className="eyebrow">Payment onboarding</div>
          <h2>Stripe setup</h2>
          <p className="small">Attach credentials once, configure commercial prices here, then keep customer checkout, subscriptions, invoices, refunds, disputes and payout status synchronized automatically.</p>
        </div>
        <div className="actions">
          <Link className="button" href="/dashboard/admin/billing/payments">Payment operations</Link>
          <Link className="button" href="/dashboard/admin/billing">Billing operations</Link>
        </div>
      </header>

      <div className="section-grid">
        <section className="card">
          <div className="eyebrow">1 · Server credentials</div>
          <h3>{setup.secretKeyConfigured ? "Stripe key attached" : "Stripe key missing"}</h3>
          <div className="small">Mode: {setup.livemode ? "live" : "test"}. `STRIPE_SECRET_KEY` stays server-only.</div>
        </section>
        <section className="card">
          <div className="eyebrow">2 · Webhook signing</div>
          <h3>{setup.webhookSecretConfigured ? "Webhook secret attached" : "Webhook secret missing"}</h3>
          <div className="small">Endpoint path: `/api/billing/webhook`. `STRIPE_WEBHOOK_SECRET` is never exposed to browsers.</div>
        </section>
        <section className="card">
          <div className="eyebrow">3 · Payout account</div>
          <h3>Stripe-managed</h3>
          <div className="small">Bank account, identity verification and payout schedule stay in Stripe Dashboard. Genithm stores only payout IDs/status/amounts.</div>
        </section>
      </div>

      <section className="card" style={{ marginTop: 18 }}>
        <div className="eyebrow">Commercial prices</div>
        <h3>Create & activate a subscription price</h3>
        <p className="small">This is MFA/AAL2 gated. One submit creates the Stripe Product/Price, maps it to Genithm and activates that paid plan. Prices are business decisions, so Genithm does not invent amounts.</p>
        <form action="/api/admin/billing/configure-price" method="post" className="list" style={{ marginTop: 12 }}>
          <label className="item">Plan<select name="planKey" defaultValue="researcher"><option value="researcher">Researcher</option><option value="professional">Professional</option><option value="team">Team</option></select></label>
          <label className="item">Billing interval<select name="interval" defaultValue="month"><option value="month">Monthly</option><option value="year">Yearly</option></select></label>
          <label className="item">Currency<input name="currency" defaultValue="USD" maxLength={3} required /></label>
          <label className="item">Amount in minor units<input name="amountMinor" inputMode="numeric" placeholder="e.g. 2900 = $29.00" required /></label>
          <button className="button" type="submit" disabled={!setup.secretKeyConfigured}>Create Stripe price & activate plan</button>
        </form>
      </section>

      <section className="card" style={{ marginTop: 18 }}>
        <div className="eyebrow">One-time Stripe Dashboard steps</div>
        <h3>Minimal provider-side setup</h3>
        <ol className="small">
          <li>Finish Stripe business verification and attach the payout bank account.</li>
          <li>Create one webhook endpoint pointing to `https://YOUR_APP/api/billing/webhook`, subscribe to the documented Genithm billing events, then attach its `whsec_...` value as `STRIPE_WEBHOOK_SECRET`.</li>
          <li>Enable Stripe Customer Portal for payment methods, invoices, plan changes, cancellation and reactivation.</li>
          <li>Test in Stripe test mode; after verification switch the secret key + webhook secret together to live mode and configure live prices with the form above.</li>
        </ol>
      </section>

      <section className="card" style={{ marginTop: 18 }}>
        <div className="eyebrow">Security boundary</div>
        <p className="small">Never paste Stripe secret keys, webhook secrets, bank details or card data into Genithm forms or source control. Credentials belong only in the deployment secret manager/environment.</p>
      </section>
    </main>
  );
}
