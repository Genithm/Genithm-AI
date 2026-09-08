import { NextResponse, type NextRequest } from "next/server";

import {
  getServiceSupabase,
  sha256Hex,
  stripeArray,
  stripeDate,
  stripeGet,
  stripeId,
  stripeObject,
  stripeTimestamp,
  verifyStripeWebhook,
} from "@/lib/stripe-server";

type JsonObject = Record<string, unknown>;

function text(value: unknown) {
  return typeof value === "string" ? value : null;
}

function integer(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : 0;
}

function boolean(value: unknown) {
  return value === true;
}

function metadataOrganization(object: JsonObject | null) {
  const metadata = object ? stripeObject(object.metadata) : null;
  return metadata ? text(metadata.genithm_organization_id) : null;
}

async function ensureCustomerMapping(customerId: string | null, livemode: boolean, explicitOrganizationId?: string | null) {
  if (!customerId) return;
  const service = getServiceSupabase();
  let organizationId = explicitOrganizationId ?? null;
  if (!organizationId) {
    const customer = await stripeGet(`/customers/${encodeURIComponent(customerId)}`);
    organizationId = metadataOrganization(customer);
  }
  if (!organizationId) throw new Error("Stripe customer is missing Genithm organization metadata");
  const { error } = await service.rpc("sync_stripe_customer", {
    organization_id: organizationId,
    livemode,
    provider_customer_id: customerId,
  });
  if (error) throw new Error("Unable to synchronize Stripe customer mapping");
}

async function syncSubscription(subscription: JsonObject, livemode: boolean, eventCreatedAt: string) {
  const service = getServiceSupabase();
  const customerId = stripeId(subscription.customer);
  await ensureCustomerMapping(customerId, livemode, metadataOrganization(subscription));

  const items = stripeObject(subscription.items);
  const firstItem = stripeObject(stripeArray(items?.data)[0]);
  const price = firstItem ? stripeObject(firstItem.price) : null;
  const priceId = stripeId(price);
  const subscriptionId = stripeId(subscription.id);
  const status = text(subscription.status);
  if (!customerId || !subscriptionId || !priceId || !status) throw new Error("Stripe subscription is missing required identifiers");

  // Stripe Basil+ moved billing periods from Subscription to Subscription Item.
  const periodStart = stripeTimestamp(firstItem?.current_period_start ?? subscription.current_period_start);
  const periodEnd = stripeTimestamp(firstItem?.current_period_end ?? subscription.current_period_end);
  const { error } = await service.rpc("sync_stripe_subscription", {
    livemode,
    provider_customer_id: customerId,
    provider_subscription_id: subscriptionId,
    provider_price_id: priceId,
    provider_status: status,
    cancel_at_period_end: boolean(subscription.cancel_at_period_end),
    current_period_start: periodStart,
    current_period_end: periodEnd,
    cancel_at: stripeTimestamp(subscription.cancel_at),
    latest_invoice_id: stripeId(subscription.latest_invoice),
    provider_created_at: stripeTimestamp(subscription.created),
    event_created_at: eventCreatedAt,
  });
  if (error) throw new Error("Unable to synchronize Stripe subscription");
}

function invoiceSubscriptionId(invoice: JsonObject) {
  const legacy = stripeId(invoice.subscription);
  if (legacy) return legacy;
  const parent = stripeObject(invoice.parent);
  const details = parent ? stripeObject(parent.subscription_details) : null;
  return stripeId(details?.subscription);
}

function invoicePaymentIntentId(invoice: JsonObject) {
  const legacy = stripeId(invoice.payment_intent);
  if (legacy) return legacy;
  const payments = stripeObject(invoice.payments);
  for (const raw of stripeArray(payments?.data)) {
    const payment = stripeObject(raw);
    const paymentDetails = payment ? stripeObject(payment.payment) : null;
    const paymentIntent = stripeId(paymentDetails?.payment_intent);
    if (paymentIntent) return paymentIntent;
  }
  return null;
}

async function syncInvoice(invoice: JsonObject, livemode: boolean) {
  const service = getServiceSupabase();
  const customerId = stripeId(invoice.customer);
  await ensureCustomerMapping(customerId, livemode);
  const invoiceId = stripeId(invoice.id);
  const currency = text(invoice.currency);
  if (!customerId || !invoiceId || !currency) throw new Error("Stripe invoice is missing required identifiers");

  const { error } = await service.rpc("sync_stripe_invoice", {
    livemode,
    provider_customer_id: customerId,
    provider_invoice_id: invoiceId,
    provider_subscription_id: invoiceSubscriptionId(invoice),
    provider_payment_intent_id: invoicePaymentIntentId(invoice),
    status: text(invoice.status),
    currency,
    amount_due_minor: integer(invoice.amount_due),
    amount_paid_minor: integer(invoice.amount_paid),
    amount_remaining_minor: integer(invoice.amount_remaining),
    hosted_invoice_url: text(invoice.hosted_invoice_url),
    invoice_pdf_url: text(invoice.invoice_pdf),
    period_start: stripeTimestamp(invoice.period_start),
    period_end: stripeTimestamp(invoice.period_end),
    provider_created_at: stripeTimestamp(invoice.created),
  });
  if (error) throw new Error("Unable to synchronize Stripe invoice");
}

async function syncPayout(payout: JsonObject, livemode: boolean) {
  const service = getServiceSupabase();
  const payoutId = stripeId(payout.id);
  const status = text(payout.status);
  const currency = text(payout.currency);
  if (!payoutId || !status || !currency) throw new Error("Stripe payout is missing required identifiers");
  const { error } = await service.rpc("sync_stripe_payout", {
    livemode,
    provider_payout_id: payoutId,
    status,
    currency,
    amount_minor: integer(payout.amount),
    arrival_date: stripeDate(payout.arrival_date),
    method: text(payout.method),
    automatic: typeof payout.automatic === "boolean" ? payout.automatic : null,
    provider_created_at: stripeTimestamp(payout.created),
  });
  if (error) throw new Error("Unable to synchronize Stripe payout");
}

async function syncRefund(refund: JsonObject, livemode: boolean) {
  const service = getServiceSupabase();
  const refundId = stripeId(refund.id);
  const paymentIntentId = stripeId(refund.payment_intent);
  const status = text(refund.status) ?? "pending";
  const currency = text(refund.currency);
  if (!refundId || !paymentIntentId || !currency) throw new Error("Stripe refund is missing required identifiers");
  const { error } = await service.rpc("sync_stripe_refund_event", {
    livemode,
    provider_refund_id: refundId,
    provider_payment_intent_id: paymentIntentId,
    status,
    amount_minor: integer(refund.amount),
    currency,
    reason: text(refund.reason),
  });
  if (error) throw new Error("Unable to synchronize Stripe refund");
}

async function syncDispute(dispute: JsonObject, livemode: boolean) {
  const service = getServiceSupabase();
  const disputeId = stripeId(dispute.id);
  const status = text(dispute.status);
  const currency = text(dispute.currency);
  if (!disputeId || !status || !currency) throw new Error("Stripe dispute is missing required identifiers");
  const { error } = await service.rpc("sync_stripe_dispute", {
    livemode,
    provider_dispute_id: disputeId,
    provider_charge_id: stripeId(dispute.charge),
    provider_payment_intent_id: stripeId(dispute.payment_intent),
    status,
    reason: text(dispute.reason),
    currency,
    amount_minor: integer(dispute.amount),
    provider_created_at: stripeTimestamp(dispute.created),
  });
  if (error) throw new Error("Unable to synchronize Stripe dispute");
}

async function syncCheckoutSession(session: JsonObject, livemode: boolean, eventCreatedAt: string) {
  const organizationId = metadataOrganization(session) ?? text(session.client_reference_id);
  const customerId = stripeId(session.customer);
  await ensureCustomerMapping(customerId, livemode, organizationId);
  const subscriptionId = stripeId(session.subscription);
  if (subscriptionId) {
    const subscription = await stripeGet(`/subscriptions/${encodeURIComponent(subscriptionId)}`);
    await syncSubscription(subscription, livemode, eventCreatedAt);
  }
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  try {
    verifyStripeWebhook(rawBody, request.headers.get("stripe-signature"));
  } catch {
    return NextResponse.json({ error: "Invalid webhook signature." }, { status: 400 });
  }

  let event: JsonObject;
  try {
    event = JSON.parse(rawBody) as JsonObject;
  } catch {
    return NextResponse.json({ error: "Invalid webhook payload." }, { status: 400 });
  }

  const eventId = text(event.id);
  const eventType = text(event.type);
  const livemode = event.livemode === true;
  const createdAt = stripeTimestamp(event.created);
  const data = stripeObject(event.data);
  const object = data ? stripeObject(data.object) : null;
  if (!eventId || !eventType || !createdAt || !object) return NextResponse.json({ error: "Incomplete webhook event." }, { status: 400 });

  const service = getServiceSupabase();
  const digest = sha256Hex(rawBody);
  const { data: priorStatus, error: beginError } = await service.rpc("begin_stripe_event", {
    livemode,
    provider_event_id: eventId,
    event_type: eventType,
    provider_created_at: createdAt,
    payload_sha256: digest,
  });
  if (beginError) return NextResponse.json({ error: "Webhook replay validation failed." }, { status: 409 });
  if (priorStatus === "processed" || priorStatus === "ignored") return NextResponse.json({ received: true, duplicate: true });

  try {
    let handled = true;
    if (eventType === "checkout.session.completed") {
      await syncCheckoutSession(object, livemode, createdAt);
    } else if (["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"].includes(eventType)) {
      await syncSubscription(object, livemode, createdAt);
    } else if (["invoice.created", "invoice.updated", "invoice.finalized", "invoice.paid", "invoice.payment_failed", "invoice.voided"].includes(eventType)) {
      await syncInvoice(object, livemode);
    } else if (["payout.created", "payout.updated", "payout.paid", "payout.failed", "payout.canceled"].includes(eventType)) {
      await syncPayout(object, livemode);
    } else if (["refund.created", "refund.updated", "refund.failed"].includes(eventType)) {
      await syncRefund(object, livemode);
    } else if (["charge.dispute.created", "charge.dispute.updated", "charge.dispute.closed"].includes(eventType)) {
      await syncDispute(object, livemode);
    } else {
      handled = false;
    }

    const { error: finishError } = await service.rpc("finish_stripe_event", {
      livemode,
      provider_event_id: eventId,
      processing_status: handled ? "processed" : "ignored",
      error_code: null,
    });
    if (finishError) throw new Error("Unable to complete Stripe event ledger entry");
    return NextResponse.json({ received: true, handled });
  } catch (error) {
    await service.rpc("finish_stripe_event", {
      livemode,
      provider_event_id: eventId,
      processing_status: "failed",
      error_code: error instanceof Error ? error.name || "stripe_sync_failed" : "stripe_sync_failed",
    });
    return NextResponse.json({ error: "Webhook reconciliation failed." }, { status: 500 });
  }
}
