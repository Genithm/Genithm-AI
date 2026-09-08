import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/stripe-server";
import { createWiseQuote, createWiseTransfer, getWiseConfig, wiseNumber, wiseObject, wiseText } from "@/lib/wise-server";

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const targetAccount = String(form.get("targetAccount") ?? "").trim();
    const sourceCurrency = String(form.get("sourceCurrency") ?? "").trim().toUpperCase();
    const targetCurrency = String(form.get("targetCurrency") ?? "").trim().toUpperCase();
    const sourceAmount = Number(String(form.get("sourceAmount") ?? ""));
    const reference = String(form.get("reference") ?? "").trim().slice(0, 70);
    if (!targetAccount) return NextResponse.json({ error: "Wise recipient/account ID is required." }, { status: 400 });
    if (!/^[A-Z]{3}$/.test(sourceCurrency) || !/^[A-Z]{3}$/.test(targetCurrency)) return NextResponse.json({ error: "Source and target currencies must be ISO currency codes." }, { status: 400 });
    if (!Number.isFinite(sourceAmount) || sourceAmount <= 0) return NextResponse.json({ error: "Source amount must be positive." }, { status: 400 });

    const supabase = await createClient();
    const { data: claimsData } = await supabase.auth.getClaims();
    if (!claimsData?.claims?.sub) return NextResponse.redirect(new URL("/login", request.url), 303);
    const { data: authorized, error: authorizationError } = await supabase.rpc("authorize_platform_billing_configuration");
    if (authorizationError || !authorized) return NextResponse.json({ error: "Platform admin MFA/AAL2 is required." }, { status: 403 });

    const config = getWiseConfig();
    const quote = await createWiseQuote({ sourceCurrency, targetCurrency, sourceAmount });
    const quoteId = wiseText(quote.id);
    if (!quoteId) throw new Error("Wise quote did not return an ID");

    const customerTransactionId = randomUUID();
    const transfer = await createWiseTransfer({
      targetAccount,
      quoteUuid: quoteId,
      customerTransactionId,
      reference: reference || undefined,
    });
    const transferId = transfer.id === undefined || transfer.id === null ? null : String(transfer.id);
    if (!transferId) throw new Error("Wise transfer creation returned no transfer ID");

    const service = getServiceSupabase();
    const { error: syncError } = await service.rpc("sync_provider_transfer_amounts", {
      provider_key: "wise",
      livemode: config.livemode,
      external_transfer_id: transferId,
      external_profile_id: config.profileId,
      external_recipient_id: targetAccount,
      status: wiseText(transfer.status) ?? "created",
      source_currency: wiseText(quote.sourceCurrency) ?? sourceCurrency,
      target_currency: wiseText(quote.targetCurrency) ?? targetCurrency,
      source_amount: wiseNumber(quote.sourceAmount) ?? sourceAmount,
      target_amount: wiseNumber(quote.targetAmount),
      rate: wiseNumber(quote.rate),
      fee_amount: (() => {
        const paymentOptions = Array.isArray(quote.paymentOptions) ? quote.paymentOptions : [];
        const first = wiseObject(paymentOptions[0]);
        const fee = first ? wiseObject(first.fee) : null;
        return wiseNumber(fee?.total);
      })(),
      estimated_delivery_at: wiseText(quote.deliveryEstimate) ?? null,
      provider_created_at: wiseText(transfer.created) ?? new Date().toISOString(),
    });
    if (syncError) throw new Error("Wise accepted the transfer but Genithm reconciliation failed; webhook/manual reconciliation can recover it.");

    const target = new URL("/dashboard/admin/billing/payments", request.url);
    target.searchParams.set("wise_transfer", transferId);
    target.searchParams.set("status", wiseText(transfer.status) ?? "created");
    return NextResponse.redirect(target, 303);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to prepare Wise transfer.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
