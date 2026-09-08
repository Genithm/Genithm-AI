import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { getServiceSupabase, getStripeConfig, stripeArray, stripeGet, stripeId, stripeObject, stripeTimestamp } from "@/lib/stripe-server";

function asText(value: unknown) {
  return typeof value === "string" ? value : null;
}

function asInt(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : 0;
}

function invoiceSubscriptionId(invoice: Record<string, unknown>) {
  const legacy = stripeId(invoice.subscription);
  if (legacy) return legacy;
  const parent = stripeObject(invoice.parent);
  const details = parent ? stripeObject(parent.subscription_details) : null;
  return stripeId(details?.subscription);
}

function invoicePaymentIntentId(invoice: Record<string, unknown>) {
  const legacy = stripeId(invoice.payment_intent);
  if (legacy) return legacy;
  const payments = stripeObject(invoice.payments);
  for (const raw of stripeArray(payments?.data)) {
    const payment = stripeObject(raw);
    const details = payment ? stripeObject(payment.payment) : null;
    const id = stripeId(details?.payment_intent);
    if (id) return id;
  }
  return null;
}

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const organizationId = String(form.get("organizationId") ?? "").trim();
    if (!organizationId) return NextResponse.json({ error: "Organization is required." }, { status: 400 });

    const supabase = await createClient();
    const { data: claimsData } = await supabase.auth.getClaims();
    if (!claimsData?.claims?.sub) return NextResponse.redirect(new URL("/login", request.url), 303);

    const { livemode } = getStripeConfig();
    const { data: rawContext, error: contextError } = await supabase.rpc("get_billing_portal_context", { organization_id: organizationId, livemode });
    if (contextError) return NextResponse.json({ error: "Billing manager access and an existing Stripe customer are required." }, { status: 403 });
    const context = stripeObject(rawContext);
    const customerId = context && typeof context.provider_customer_id === "string" ? context.provider_customer_id : null;
    if (!customerId) return NextResponse.json({ error: "Stripe customer mapping is missing." }, { status: 409 });

    const service = getServiceSupabase();
    const subscriptions = await stripeGet("/subscriptions", { customer: customerId, status: "all", limit: 20 });
    let subscriptionCount = 0;
    for (const raw of stripeArray(subscriptions.data)) {
      const subscription = stripeObject(raw);
      if (!subscription) continue;
      const items = stripeObject(subscription.items);
      const firstItem = stripeObject(stripeArray(items?.data)[0]);
      const price = firstItem ? stripeObject(firstItem.price) : null;
      const subscriptionId = stripeId(subscription.id);
      const priceId = stripeId(price);
      const status = asText(subscription.status);
      if (!subscriptionId || !priceId || !status) continue;
      const { error } = await service.rpc("sync_stripe_subscription", {
        livemode,
        provider_customer_id: customerId,
        provider_subscription_id: subscriptionId,
        provider_price_id: priceId,
        provider_status: status,
        cancel_at_period_end: subscription.cancel_at_period_end === true,
        current_period_start: stripeTimestamp(firstItem?.current_period_start ?? subscription.current_period_start),
        current_period_end: stripeTimestamp(firstItem?.current_period_end ?? subscription.current_period_end),
        cancel_at: stripeTimestamp(subscription.cancel_at),
        latest_invoice_id: stripeId(subscription.latest_invoice),
        provider_created_at: stripeTimestamp(subscription.created),
      });
      if (error) throw new Error("Subscription reconciliation failed");
      subscriptionCount += 1;
    }

    const invoices = await stripeGet("/invoices", { customer: customerId, limit: 24 });
    let invoiceCount = 0;
    for (const raw of stripeArray(invoices.data)) {
      const invoice = stripeObject(raw);
      if (!invoice) continue;
      const invoiceId = stripeId(invoice.id);
      const currency = asText(invoice.currency);
      if (!invoiceId || !currency) continue;
      const { error } = await service.rpc("sync_stripe_invoice", {
        livemode,
        provider_customer_id: customerId,
        provider_invoice_id: invoiceId,
        provider_subscription_id: invoiceSubscriptionId(invoice),
        provider_payment_intent_id: invoicePaymentIntentId(invoice),
        status: asText(invoice.status),
        currency,
        amount_due_minor: asInt(invoice.amount_due),
        amount_paid_minor: asInt(invoice.amount_paid),
        amount_remaining_minor: asInt(invoice.amount_remaining),
        hosted_invoice_url: asText(invoice.hosted_invoice_url),
        invoice_pdf_url: asText(invoice.invoice_pdf),
        period_start: stripeTimestamp(invoice.period_start),
        period_end: stripeTimestamp(invoice.period_end),
        provider_created_at: stripeTimestamp(invoice.created),
      });
      if (error) throw new Error("Invoice reconciliation failed");
      invoiceCount += 1;
    }

    const target = new URL("/dashboard/billing/payments", request.url);
    target.searchParams.set("organization", organizationId);
    target.searchParams.set("synced", `${subscriptionCount}:${invoiceCount}`);
    return NextResponse.redirect(target, 303);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to reconcile Stripe billing.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
