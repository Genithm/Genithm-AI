import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { getServiceSupabase, stripeFormRequest, stripeId, stripeObject } from "@/lib/stripe-server";

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const providerInvoiceId = String(form.get("providerInvoiceId") ?? "").trim();
    const reason = String(form.get("reason") ?? "requested_by_customer").trim();
    const amountRaw = String(form.get("amountMinor") ?? "").trim();
    const amountMinor = amountRaw ? Number.parseInt(amountRaw, 10) : null;
    if (!providerInvoiceId) return NextResponse.json({ error: "Invoice ID is required." }, { status: 400 });
    if (amountRaw && (!Number.isSafeInteger(amountMinor) || (amountMinor ?? 0) <= 0)) {
      return NextResponse.json({ error: "Refund amount must be a positive integer in minor currency units." }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: claimsData } = await supabase.auth.getClaims();
    if (!claimsData?.claims?.sub) return NextResponse.redirect(new URL("/login", request.url), 303);

    const { data: rawAuthorization, error: authorizationError } = await supabase.rpc("request_platform_refund", {
      provider_invoice_id: providerInvoiceId,
      amount_minor: amountMinor,
      reason,
    });
    if (authorizationError) {
      return NextResponse.json({ error: "Refund authorization failed. Platform admin access with MFA is required, and the invoice must have refundable funds." }, { status: 403 });
    }
    const authorization = stripeObject(rawAuthorization);
    const requestId = authorization && typeof authorization.refund_request_id === "string" ? authorization.refund_request_id : null;
    const paymentIntentId = authorization && typeof authorization.provider_payment_intent_id === "string" ? authorization.provider_payment_intent_id : null;
    const authorizedAmount = authorization && typeof authorization.amount_minor === "number" ? authorization.amount_minor : null;
    const authorizedCurrency = authorization && typeof authorization.currency === "string" ? authorization.currency.toLowerCase() : null;
    if (!requestId || !paymentIntentId || !authorizedAmount || !authorizedCurrency) throw new Error("Refund authorization returned incomplete data");

    const stripeReason = ["duplicate", "fraudulent", "requested_by_customer"].includes(reason) ? reason : null;
    const refund = await stripeFormRequest("/refunds", {
      payment_intent: paymentIntentId,
      amount: authorizedAmount,
      reason: stripeReason,
      "metadata[genithm_refund_request_id]": requestId,
      "metadata[genithm_invoice_id]": providerInvoiceId,
    }, { idempotencyKey: `genithm-refund-${requestId}` });

    const refundId = stripeId(refund.id);
    const status = typeof refund.status === "string" ? refund.status : "pending";
    const currency = typeof refund.currency === "string" ? refund.currency : authorizedCurrency;
    const amount = typeof refund.amount === "number" ? refund.amount : authorizedAmount;
    if (!refundId) throw new Error("Stripe refund returned incomplete data");

    const service = getServiceSupabase();
    const { error: syncError } = await service.rpc("complete_stripe_refund", {
      refund_request_id: requestId,
      provider_refund_id: refundId,
      status,
      amount_minor: amount,
      currency,
    });
    if (syncError) throw new Error("Stripe accepted the refund, but local reconciliation is pending. Webhook reconciliation will retry the state sync.");

    return NextResponse.redirect(new URL("/dashboard/admin/billing/payments?refund=submitted", request.url), 303);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to process refund.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
