import { NextResponse, type NextRequest } from "next/server";

import { paypalObject, paypalRequest, paypalText } from "@/lib/paypal-server";
import { createClient } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/stripe-server";

function paypalAmount(value: unknown) {
  const amount = paypalObject(value);
  if (!amount) return null;
  const currency = paypalText(amount.currency) ?? paypalText(amount.currency_code);
  const rawValue = paypalText(amount.total) ?? paypalText(amount.value);
  if (!currency || !rawValue) return null;
  const numeric = Number(rawValue);
  return Number.isFinite(numeric) && numeric > 0 ? { currency: currency.toUpperCase(), amount: numeric } : null;
}

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const saleId = String(form.get("externalTransactionId") ?? "").trim();
    const reason = String(form.get("reason") ?? "requested_by_customer").trim();
    const amountRaw = String(form.get("amount") ?? "").trim();
    const amount = amountRaw ? Number(amountRaw) : null;

    if (!saleId) return NextResponse.json({ error: "PayPal sale transaction ID is required." }, { status: 400 });
    if (amountRaw && (!Number.isFinite(amount) || (amount ?? 0) <= 0)) {
      return NextResponse.json({ error: "Refund amount must be a positive number in major currency units." }, { status: 400 });
    }
    if (!["duplicate", "fraudulent", "requested_by_customer", "other"].includes(reason)) {
      return NextResponse.json({ error: "Unsupported refund reason." }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: claimsData } = await supabase.auth.getClaims();
    if (!claimsData?.claims?.sub) return NextResponse.redirect(new URL("/login", request.url), 303);

    const { data: rawAuthorization, error: authorizationError } = await supabase.rpc("request_provider_refund", {
      provider_key: "paypal",
      external_transaction_id: saleId,
      amount,
      reason,
    });
    if (authorizationError || !rawAuthorization || typeof rawAuthorization !== "object" || Array.isArray(rawAuthorization)) {
      return NextResponse.json({ error: "PayPal refund authorization failed. Platform admin MFA/AAL2 is required, and the sale must have refundable funds." }, { status: 403 });
    }

    const authorization = rawAuthorization as Record<string, unknown>;
    const requestId = typeof authorization.refund_request_id === "string" ? authorization.refund_request_id : null;
    const authorizedSaleId = typeof authorization.external_transaction_id === "string" ? authorization.external_transaction_id : null;
    const authorizedAmount = typeof authorization.amount === "number" ? authorization.amount : Number(authorization.amount);
    const currency = typeof authorization.currency === "string" ? authorization.currency.toUpperCase() : null;
    if (!requestId || !authorizedSaleId || !Number.isFinite(authorizedAmount) || authorizedAmount <= 0 || !currency) {
      throw new Error("PayPal refund authorization returned incomplete data");
    }

    const refund = await paypalRequest(`/v1/payments/sale/${encodeURIComponent(authorizedSaleId)}/refund`, {
      method: "POST",
      requestId: `genithm-paypal-refund-${requestId}`,
      body: {
        amount: { total: String(authorizedAmount), currency },
        description: reason === "other" ? "Genithm billing refund" : reason.replaceAll("_", " "),
        invoice_number: `genithm-refund-${requestId}`,
      },
    });

    const refundId = paypalText(refund.id);
    const status = paypalText(refund.state) ?? "pending";
    const refundAmount = paypalAmount(refund.amount) ?? { amount: authorizedAmount, currency };
    if (!refundId) throw new Error("PayPal accepted the refund but returned no refund ID");

    const service = getServiceSupabase();
    const { error: syncError } = await service.rpc("complete_provider_refund", {
      refund_request_id: requestId,
      external_refund_id: refundId,
      status,
      amount: refundAmount.amount,
      currency: refundAmount.currency,
    });
    if (syncError) throw new Error("PayPal accepted the refund, but local reconciliation is pending. The PayPal webhook will reconcile the final state.");

    return NextResponse.redirect(new URL("/dashboard/admin/billing/payments?paypal_refund=submitted", request.url), 303);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to process PayPal refund.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
