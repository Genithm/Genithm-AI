import { NextResponse, type NextRequest } from "next/server";

import { getPayPalConfig, paypalObject, paypalRequest, paypalText } from "@/lib/paypal-server";
import { createClient } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/stripe-server";

function iso(value: unknown) {
  if (typeof value !== "string" || !value) return null;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const organizationId = String(form.get("organizationId") ?? "").trim();
    const subscriptionId = String(form.get("subscriptionId") ?? "").trim();
    const action = String(form.get("action") ?? "").trim().toLowerCase();
    if (!organizationId || !subscriptionId || !["cancel", "activate"].includes(action)) {
      return NextResponse.json({ error: "Organization, subscription and supported action are required." }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: claimsData } = await supabase.auth.getClaims();
    if (!claimsData?.claims?.sub) return NextResponse.redirect(new URL("/login", request.url), 303);

    const { livemode } = getPayPalConfig();
    const { error: contextError } = await (supabase as any).rpc("get_provider_subscription_management_context", {
      organization_id: organizationId,
      provider_key: "paypal",
      external_subscription_id: subscriptionId,
      livemode,
    });
    if (contextError) return NextResponse.json({ error: "Billing manager access to this PayPal subscription is required." }, { status: 403 });

    if (action === "cancel") {
      await paypalRequest(`/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`, {
        method: "POST",
        body: { reason: "Cancelled by organization billing manager in Genithm" },
      });
    } else {
      await paypalRequest(`/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}/activate`, {
        method: "POST",
        body: { reason: "Reactivated by organization billing manager in Genithm" },
      });
    }

    const subscription = await paypalRequest(`/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}`);
    const billingInfo = paypalObject(subscription.billing_info);
    const lastPayment = billingInfo ? paypalObject(billingInfo.last_payment) : null;
    const subscriber = paypalObject(subscription.subscriber);
    const planId = paypalText(subscription.plan_id);
    const status = paypalText(subscription.status);
    if (!planId || !status) throw new Error("PayPal returned incomplete subscription state after management action");

    const service = getServiceSupabase();
    const { error: syncError } = await service.rpc("sync_provider_subscription", {
      organization_id: organizationId,
      provider_key: "paypal",
      livemode,
      external_subscription_id: subscriptionId,
      external_price_id: planId,
      external_customer_id: subscriber ? paypalText(subscriber.payer_id) : null,
      provider_status: status,
      current_period_start: iso(lastPayment?.time ?? subscription.start_time),
      current_period_end: iso(billingInfo?.next_billing_time),
      provider_created_at: iso(subscription.create_time ?? subscription.start_time),
      event_created_at: iso(subscription.status_update_time) ?? new Date().toISOString(),
    });
    if (syncError) throw new Error("PayPal action succeeded but local subscription reconciliation failed; webhook reconciliation will retry.");

    const target = new URL("/dashboard/billing/payments", request.url);
    target.searchParams.set("organization", organizationId);
    target.searchParams.set("paypal_action", action);
    return NextResponse.redirect(target, 303);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to manage PayPal subscription.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
