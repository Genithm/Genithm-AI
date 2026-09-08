import { NextResponse, type NextRequest } from "next/server";

import { getPayPalConfig, paypalObject, paypalRequest, paypalText, verifyPayPalWebhook } from "@/lib/paypal-server";
import { getServiceSupabase, sha256Hex } from "@/lib/stripe-server";

function iso(value: unknown) {
  if (typeof value !== "string" || !value) return null;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

function paypalAmount(value: unknown) {
  const amount = paypalObject(value);
  if (!amount) return null;
  const currency = paypalText(amount.currency) ?? paypalText(amount.currency_code);
  const rawValue = paypalText(amount.total) ?? paypalText(amount.value);
  if (!currency || !rawValue) return null;
  const numeric = Number(rawValue);
  if (!Number.isFinite(numeric) || numeric < 0 || !/^[A-Z]{3}$/i.test(currency)) return null;
  return { currency: currency.toUpperCase(), amount: numeric };
}

async function syncSubscription(resource: Record<string, unknown>, eventCreatedAt: string | null, livemode: boolean) {
  const subscriptionId = paypalText(resource.id);
  if (!subscriptionId) throw new Error("PayPal subscription event is missing subscription ID");
  const subscription = await paypalRequest(`/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}`);
  const organizationId = paypalText(subscription.custom_id);
  const planId = paypalText(subscription.plan_id);
  const status = paypalText(subscription.status);
  if (!organizationId || !planId || !status) throw new Error("PayPal subscription is missing Genithm organization, plan, or status");

  const subscriber = paypalObject(subscription.subscriber);
  const billingInfo = paypalObject(subscription.billing_info);
  const lastPayment = billingInfo ? paypalObject(billingInfo.last_payment) : null;
  const payerId = subscriber ? paypalText(subscriber.payer_id) : null;

  const service = getServiceSupabase();
  const { error } = await service.rpc("sync_provider_subscription", {
    organization_id: organizationId,
    provider_key: "paypal",
    livemode,
    external_subscription_id: subscriptionId,
    external_price_id: planId,
    external_customer_id: payerId,
    provider_status: status,
    current_period_start: iso(lastPayment?.time ?? subscription.start_time),
    current_period_end: iso(billingInfo?.next_billing_time),
    provider_created_at: iso(subscription.create_time ?? subscription.start_time),
    event_created_at: eventCreatedAt ?? iso(subscription.status_update_time) ?? new Date().toISOString(),
  });
  if (error) throw new Error("Unable to synchronize PayPal subscription state");
}

async function syncSale(resource: Record<string, unknown>, eventType: string, eventCreatedAt: string | null, livemode: boolean) {
  const saleId = paypalText(resource.id);
  const subscriptionId = paypalText(resource.billing_agreement_id);
  const amount = paypalAmount(resource.amount);
  if (!saleId || !subscriptionId || !amount) throw new Error("PayPal sale event is missing sale, subscription, currency, or amount");

  const status = paypalText(resource.state) ?? eventType.replace("PAYMENT.SALE.", "").toLowerCase();
  const refundable = eventType === "PAYMENT.SALE.COMPLETED" ? amount.amount : 0;
  const service = getServiceSupabase();
  const { error } = await service.rpc("sync_provider_transaction", {
    organization_id: null,
    provider_key: "paypal",
    livemode,
    external_transaction_id: saleId,
    external_subscription_id: subscriptionId,
    external_parent_transaction_id: null,
    transaction_kind: "payment",
    status,
    currency: amount.currency,
    amount: amount.amount,
    refundable_amount: refundable,
    provider_reason: null,
    provider_status_detail: eventType,
    provider_created_at: iso(resource.create_time) ?? eventCreatedAt,
  });
  if (error) throw new Error("Unable to synchronize PayPal subscription payment");
}

async function syncSaleRefund(resource: Record<string, unknown>, eventType: string, eventCreatedAt: string | null, livemode: boolean) {
  const refundId = paypalText(resource.id);
  const saleId = paypalText(resource.sale_id) ?? paypalText(resource.capture_id);
  const amount = paypalAmount(resource.amount);
  if (!refundId || !saleId || !amount) throw new Error("PayPal refund event is missing refund, parent sale, currency, or amount");

  const status = paypalText(resource.state) ?? (eventType.endsWith("REFUNDED") ? "completed" : "reversed");
  const service = getServiceSupabase();
  const { error } = await service.rpc("sync_provider_refund_event", {
    provider_key: "paypal",
    livemode,
    external_refund_id: refundId,
    external_parent_transaction_id: saleId,
    status,
    currency: amount.currency,
    amount: amount.amount,
    provider_created_at: iso(resource.create_time) ?? eventCreatedAt,
  });
  if (error) throw new Error("Unable to synchronize PayPal refund");
}

async function syncDispute(resource: Record<string, unknown>, eventType: string, eventCreatedAt: string | null, livemode: boolean) {
  const disputeId = paypalText(resource.dispute_id) ?? paypalText(resource.id);
  const amount = paypalAmount(resource.dispute_amount);
  const transactions = Array.isArray(resource.disputed_transactions) ? resource.disputed_transactions : [];
  const firstTransaction = transactions.length ? paypalObject(transactions[0]) : null;
  const parentTransactionId = firstTransaction
    ? paypalText(firstTransaction.seller_transaction_id) ?? paypalText(firstTransaction.buyer_transaction_id)
    : null;
  if (!disputeId || !amount) throw new Error("PayPal dispute event is missing dispute ID, currency, or amount");

  const service = getServiceSupabase();
  const { error } = await service.rpc("sync_provider_transaction", {
    organization_id: null,
    provider_key: "paypal",
    livemode,
    external_transaction_id: disputeId,
    external_subscription_id: null,
    external_parent_transaction_id: parentTransactionId,
    transaction_kind: "dispute",
    status: paypalText(resource.status) ?? eventType.replace("CUSTOMER.DISPUTE.", "").toLowerCase(),
    currency: amount.currency,
    amount: amount.amount,
    refundable_amount: 0,
    provider_reason: paypalText(resource.reason),
    provider_status_detail: paypalText(resource.dispute_life_cycle_stage) ?? eventType,
    provider_created_at: iso(resource.create_time) ?? eventCreatedAt,
  });
  if (error) throw new Error("Unable to synchronize PayPal dispute");
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  let event: Record<string, unknown>;
  try {
    event = await verifyPayPalWebhook(rawBody, request.headers);
  } catch {
    return NextResponse.json({ error: "Invalid PayPal webhook signature." }, { status: 400 });
  }

  const eventId = paypalText(event.id);
  const eventType = paypalText(event.event_type);
  const resource = paypalObject(event.resource);
  const eventCreatedAt = iso(event.create_time);
  if (!eventId || !eventType || !resource) return NextResponse.json({ error: "Incomplete PayPal webhook event." }, { status: 400 });

  const { livemode } = getPayPalConfig();
  const service = getServiceSupabase();
  const { data: priorStatus, error: beginError } = await service.rpc("begin_provider_webhook_event", {
    provider_key: "paypal",
    livemode,
    external_event_id: eventId,
    event_type: eventType,
    payload_sha256: sha256Hex(rawBody),
    provider_created_at: eventCreatedAt,
  });
  if (beginError) return NextResponse.json({ error: "PayPal webhook replay validation failed." }, { status: 409 });
  if (priorStatus === "processed" || priorStatus === "ignored") return NextResponse.json({ received: true, duplicate: true });

  try {
    let handled = false;
    if (eventType.startsWith("BILLING.SUBSCRIPTION.")) {
      await syncSubscription(resource, eventCreatedAt, livemode);
      handled = true;
    } else if (["PAYMENT.SALE.COMPLETED", "PAYMENT.SALE.PENDING", "PAYMENT.SALE.DENIED"].includes(eventType)) {
      await syncSale(resource, eventType, eventCreatedAt, livemode);
      handled = true;
    } else if (["PAYMENT.SALE.REFUNDED", "PAYMENT.SALE.REVERSED"].includes(eventType)) {
      await syncSaleRefund(resource, eventType, eventCreatedAt, livemode);
      handled = true;
    } else if (eventType.startsWith("CUSTOMER.DISPUTE.")) {
      await syncDispute(resource, eventType, eventCreatedAt, livemode);
      handled = true;
    }

    const { error: finishError } = await service.rpc("finish_provider_webhook_event", {
      provider_key: "paypal",
      livemode,
      external_event_id: eventId,
      status: handled ? "processed" : "ignored",
      error_code: null,
    });
    if (finishError) throw new Error("Unable to finalize PayPal webhook ledger entry");
    return NextResponse.json({ received: true, handled });
  } catch (error) {
    await service.rpc("finish_provider_webhook_event", {
      provider_key: "paypal",
      livemode,
      external_event_id: eventId,
      status: "failed",
      error_code: error instanceof Error ? error.name || "paypal_sync_failed" : "paypal_sync_failed",
    });
    return NextResponse.json({ error: "PayPal webhook reconciliation failed." }, { status: 500 });
  }
}
