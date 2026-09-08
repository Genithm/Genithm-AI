import { NextResponse, type NextRequest } from "next/server";

import { paypalObject, paypalRequest, paypalText, verifyPayPalWebhook } from "@/lib/paypal-server";
import { getServiceSupabase, sha256Hex } from "@/lib/stripe-server";

function iso(value: unknown) {
  if (typeof value !== "string" || !value) return null;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
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

  const { livemode } = (await import("@/lib/paypal-server")).getPayPalConfig();
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
