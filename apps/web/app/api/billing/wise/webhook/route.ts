import { NextResponse, type NextRequest } from "next/server";

import { getServiceSupabase, sha256Hex } from "@/lib/stripe-server";
import { getWiseConfig, verifyWiseWebhook, wiseNumber, wiseObject, wiseRequest, wiseText } from "@/lib/wise-server";

function iso(value: unknown) {
  if (typeof value !== "string" || !value) return null;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  try {
    verifyWiseWebhook(rawBody, request.headers.get("x-signature-sha256"));
  } catch {
    return NextResponse.json({ error: "Invalid Wise webhook signature." }, { status: 400 });
  }

  let event: Record<string, unknown>;
  try {
    event = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid Wise webhook payload." }, { status: 400 });
  }

  const eventType = wiseText(event.event_type);
  const deliveryId = request.headers.get("x-delivery-id")?.trim() || null;
  const sentAt = iso(event.sent_at);
  const data = wiseObject(event.data);
  const resource = data ? wiseObject(data.resource) : null;
  const transferId = resource && resource.id !== undefined && resource.id !== null ? String(resource.id) : null;
  if (!eventType || !deliveryId) return NextResponse.json({ error: "Incomplete Wise webhook event." }, { status: 400 });

  const config = getWiseConfig();
  const service = getServiceSupabase();
  const { data: priorStatus, error: beginError } = await service.rpc("begin_provider_webhook_event", {
    provider_key: "wise",
    livemode: config.livemode,
    external_event_id: deliveryId,
    event_type: eventType,
    payload_sha256: sha256Hex(rawBody),
    provider_created_at: sentAt,
  });
  if (beginError) return NextResponse.json({ error: "Wise webhook replay validation failed." }, { status: 409 });
  if (priorStatus === "processed" || priorStatus === "ignored") return NextResponse.json({ received: true, duplicate: true });

  try {
    let handled = false;
    if (transferId && ["transfers#state-change", "transfers#payout-failure", "transfers#refund"].includes(eventType)) {
      const transfer = await wiseRequest(`/v1/transfers/${encodeURIComponent(transferId)}`);
      const sourceCurrency = wiseText(transfer.sourceCurrency);
      const targetCurrency = wiseText(transfer.targetCurrency);
      if (!sourceCurrency || !targetCurrency) throw new Error("Wise transfer response is missing source or target currency");

      const { error: syncError } = await service.rpc("sync_provider_transfer_amounts", {
        provider_key: "wise",
        livemode: config.livemode,
        external_transfer_id: transferId,
        external_profile_id: resource?.profile_id === undefined || resource?.profile_id === null ? config.profileId : String(resource.profile_id),
        external_recipient_id: transfer.targetAccount === undefined || transfer.targetAccount === null ? null : String(transfer.targetAccount),
        status: wiseText(data?.current_state) ?? wiseText(transfer.status) ?? eventType,
        source_currency: sourceCurrency,
        target_currency: targetCurrency,
        source_amount: wiseNumber(transfer.sourceValue),
        target_amount: wiseNumber(transfer.targetValue),
        rate: wiseNumber(transfer.rate),
        fee_amount: wiseNumber(transfer.fee),
        estimated_delivery_at: iso(transfer.estimatedDelivery),
        provider_created_at: iso(transfer.created),
      });
      if (syncError) throw new Error("Unable to synchronize Wise transfer state");
      handled = true;
    }

    const { error: finishError } = await service.rpc("finish_provider_webhook_event", {
      provider_key: "wise",
      livemode: config.livemode,
      external_event_id: deliveryId,
      status: handled ? "processed" : "ignored",
      error_code: null,
    });
    if (finishError) throw new Error("Unable to finalize Wise webhook ledger entry");
    return NextResponse.json({ received: true, handled });
  } catch (error) {
    await service.rpc("finish_provider_webhook_event", {
      provider_key: "wise",
      livemode: config.livemode,
      external_event_id: deliveryId,
      status: "failed",
      error_code: error instanceof Error ? error.name || "wise_sync_failed" : "wise_sync_failed",
    });
    return NextResponse.json({ error: "Wise webhook reconciliation failed." }, { status: 500 });
  }
}
