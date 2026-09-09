import { NextResponse, type NextRequest } from "next/server";

import { getPayPalAccessToken, getPayPalConfig, paypalObject, paypalRequest, paypalText } from "@/lib/paypal-server";
import { createClient } from "@/lib/supabase/server";
import { getServiceSupabase, getStripeConfig, stripeArray, stripeGet, stripeId, stripeObject, stripeTimestamp } from "@/lib/stripe-server";
import { getWiseConfig, verifyWiseConnection, wiseNumber, wiseRequest, wiseText } from "@/lib/wise-server";

type Row = Record<string, unknown>;

function rows(value: unknown): Row[] {
  return Array.isArray(value) ? value.filter((item): item is Row => typeof item === "object" && item !== null && !Array.isArray(item)) : [];
}

function iso(value: unknown) {
  if (typeof value !== "string" || !value) return null;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

async function verifyProvider(provider: string) {
  if (provider === "stripe") {
    const config = getStripeConfig();
    const account = await stripeGet("/account");
    return {
      livemode: config.livemode,
      externalAccountId: stripeId(account.id),
      externalProfileId: null,
      capabilities: ["checkout", "subscriptions", "portal", "invoices", "refunds", "disputes", "payouts", "webhooks"],
    };
  }
  if (provider === "paypal") {
    const config = getPayPalConfig();
    await getPayPalAccessToken();
    return {
      livemode: config.livemode,
      externalAccountId: null,
      externalProfileId: null,
      capabilities: ["checkout", "subscriptions", "invoices", "refunds", "disputes", "webhooks"],
    };
  }
  const config = getWiseConfig();
  await verifyWiseConnection();
  return {
    livemode: config.livemode,
    externalAccountId: null,
    externalProfileId: config.profileId,
    capabilities: ["payouts", "transfers", "webhooks"],
  };
}

async function reconcileStripe(service: ReturnType<typeof getServiceSupabase>, targets: Row[]) {
  let success = 0;
  let failure = 0;
  for (const target of targets) {
    const customerId = typeof target.provider_customer_id === "string" ? target.provider_customer_id : null;
    if (!customerId) { failure += 1; continue; }
    try {
      const reconciliationTime = new Date().toISOString();
      const subscriptions = await stripeGet("/subscriptions", { customer: customerId, status: "all", limit: 20 });
      for (const raw of stripeArray(subscriptions.data)) {
        const subscription = stripeObject(raw);
        if (!subscription) continue;
        const items = stripeObject(subscription.items);
        const firstItem = stripeObject(stripeArray(items?.data)[0]);
        const price = firstItem ? stripeObject(firstItem.price) : null;
        const subscriptionId = stripeId(subscription.id);
        const priceId = stripeId(price);
        const status = typeof subscription.status === "string" ? subscription.status : null;
        if (!subscriptionId || !priceId || !status) continue;
        const { error } = await service.rpc("sync_stripe_subscription", {
          livemode: getStripeConfig().livemode,
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
          event_created_at: reconciliationTime,
        });
        if (error) throw new Error("stripe_subscription_sync_failed");
      }
      success += 1;
    } catch {
      failure += 1;
    }
  }
  return { success, failure };
}

async function reconcilePayPal(service: ReturnType<typeof getServiceSupabase>, targets: Row[], livemode: boolean) {
  let success = 0;
  let failure = 0;
  for (const target of targets) {
    const subscriptionId = typeof target.external_subscription_id === "string" ? target.external_subscription_id : null;
    const organizationId = typeof target.organization_id === "string" ? target.organization_id : null;
    if (!subscriptionId || !organizationId) { failure += 1; continue; }
    try {
      const subscription = await paypalRequest(`/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}`);
      const billingInfo = paypalObject(subscription.billing_info);
      const lastPayment = billingInfo ? paypalObject(billingInfo.last_payment) : null;
      const subscriber = paypalObject(subscription.subscriber);
      const planId = paypalText(subscription.plan_id);
      const status = paypalText(subscription.status);
      if (!planId || !status) throw new Error("paypal_subscription_incomplete");
      const { error } = await service.rpc("sync_provider_subscription", {
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
      if (error) throw new Error("paypal_subscription_sync_failed");
      success += 1;
    } catch {
      failure += 1;
    }
  }
  return { success, failure };
}

async function reconcileWise(service: ReturnType<typeof getServiceSupabase>, targets: Row[], livemode: boolean) {
  const config = getWiseConfig();
  let success = 0;
  let failure = 0;
  for (const target of targets) {
    const transferId = target.external_transfer_id === null || target.external_transfer_id === undefined ? null : String(target.external_transfer_id);
    if (!transferId) { failure += 1; continue; }
    try {
      const transfer = await wiseRequest(`/v1/transfers/${encodeURIComponent(transferId)}`);
      const sourceCurrency = wiseText(transfer.sourceCurrency);
      const targetCurrency = wiseText(transfer.targetCurrency);
      if (!sourceCurrency || !targetCurrency) throw new Error("wise_transfer_currency_missing");
      const { error } = await service.rpc("sync_provider_transfer_amounts", {
        provider_key: "wise",
        livemode,
        external_transfer_id: transferId,
        external_profile_id: target.external_profile_id === null || target.external_profile_id === undefined ? config.profileId : String(target.external_profile_id),
        external_recipient_id: transfer.targetAccount === undefined || transfer.targetAccount === null ? null : String(transfer.targetAccount),
        status: wiseText(transfer.status) ?? String(target.status ?? "unknown"),
        source_currency: sourceCurrency,
        target_currency: targetCurrency,
        source_amount: wiseNumber(transfer.sourceValue),
        target_amount: wiseNumber(transfer.targetValue),
        rate: wiseNumber(transfer.rate),
        fee_amount: wiseNumber(transfer.fee),
        estimated_delivery_at: iso(transfer.estimatedDelivery),
        provider_created_at: iso(transfer.created),
      });
      if (error) throw new Error("wise_transfer_sync_failed");
      success += 1;
    } catch {
      failure += 1;
    }
  }
  return { success, failure };
}

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const provider = String(form.get("provider") ?? "").trim().toLowerCase();
  if (!["stripe", "paypal", "wise"].includes(provider)) return NextResponse.json({ error: "Unsupported provider." }, { status: 400 });

  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = typeof claimsData?.claims?.sub === "string" ? claimsData.claims.sub : null;
  if (!userId) return NextResponse.redirect(new URL("/login", request.url), 303);
  const { data: authorized, error: authorizationError } = await supabase.rpc("authorize_platform_billing_configuration");
  if (authorizationError || !authorized) return NextResponse.json({ error: "Platform admin MFA/AAL2 is required." }, { status: 403 });

  const service = getServiceSupabase();
  let runId: string | null = null;
  let livemode = false;
  try {
    const verified = await verifyProvider(provider);
    livemode = verified.livemode;
    const { error: connectionError } = await service.rpc("upsert_payment_provider_connection", {
      provider_key: provider,
      livemode,
      external_account_id: verified.externalAccountId,
      external_profile_id: verified.externalProfileId,
      connection_status: "verified",
      capabilities: verified.capabilities,
      error_code: null,
    });
    if (connectionError) throw new Error("provider_connection_state_failed");

    const { data: run, error: runError } = await service.rpc("begin_provider_reconciliation", {
      provider_key: provider,
      livemode,
      reconciliation_scope: "platform",
      organization_id: null,
      trigger_source: "admin",
      requested_by: userId,
    });
    if (runError || typeof run !== "string") throw new Error("reconciliation_run_start_failed");
    runId = run;

    const { data: rawTargets, error: targetsError } = await service.rpc("get_provider_reconciliation_targets", {
      provider_key: provider,
      livemode,
      limit_count: 100,
    });
    if (targetsError || !rawTargets || typeof rawTargets !== "object" || Array.isArray(rawTargets)) throw new Error("reconciliation_targets_failed");
    const targets = rawTargets as Row;

    let result: { success: number; failure: number };
    let targetCount: number;
    if (provider === "stripe") {
      const stripeCustomers = rows(targets.stripe_customers);
      targetCount = stripeCustomers.length;
      result = await reconcileStripe(service, stripeCustomers);
    } else if (provider === "paypal") {
      const subscriptions = rows(targets.subscriptions);
      targetCount = subscriptions.length;
      result = await reconcilePayPal(service, subscriptions, livemode);
    } else {
      const transfers = rows(targets.transfers);
      targetCount = transfers.length;
      result = await reconcileWise(service, transfers, livemode);
    }

    const status = result.failure === 0 ? "succeeded" : result.success > 0 ? "partial" : "failed";
    const { error: finishError } = await service.rpc("finish_provider_reconciliation", {
      run_id: runId,
      status,
      target_count: targetCount,
      success_count: result.success,
      failure_count: result.failure,
      result_summary: { provider, authoritative_targets: targetCount },
      error_code: result.failure ? `${provider}_reconciliation_target_failed` : null,
    });
    if (finishError) throw new Error("reconciliation_run_finish_failed");

    if (status === "succeeded") {
      await service.rpc("resolve_failed_provider_webhooks", {
        provider_key: provider,
        livemode,
        reconciliation_run_id: runId,
      });
    }

    const target = new URL("/dashboard/admin/billing/payments", request.url);
    target.searchParams.set("provider", provider);
    target.searchParams.set("reconciled", `${result.success}:${result.failure}`);
    return NextResponse.redirect(target, 303);
  } catch (error) {
    const code = error instanceof Error && error.message ? error.message.slice(0, 120) : "provider_reconciliation_failed";
    if (runId) {
      try {
        await service.rpc("finish_provider_reconciliation", {
          run_id: runId,
          status: "failed",
          target_count: 0,
          success_count: 0,
          failure_count: 0,
          result_summary: { provider },
          error_code: code,
        });
      } catch {
        // Best-effort run finalization; the original reconciliation failure remains authoritative.
      }
    }
    try {
      const mode = provider === "stripe" ? getStripeConfig().livemode : provider === "paypal" ? getPayPalConfig().livemode : getWiseConfig().livemode;
      await service.rpc("mark_payment_provider_connection_degraded", { provider_key: provider, livemode: mode, error_code: code });
    } catch {
      // Credentials may be missing; no provider secret or raw error is persisted.
    }
    return NextResponse.json({ error: "Provider reconciliation failed. The connection was marked degraded when its environment could be identified." }, { status: 500 });
  }
}
