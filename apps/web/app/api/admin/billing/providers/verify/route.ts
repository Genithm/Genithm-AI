import { NextResponse, type NextRequest } from "next/server";

import { getPayPalAccessToken, getPayPalConfig } from "@/lib/paypal-server";
import { createClient } from "@/lib/supabase/server";
import { getServiceSupabase, getStripeConfig, stripeGet, stripeId } from "@/lib/stripe-server";
import { getWiseConfig, verifyWiseConnection } from "@/lib/wise-server";

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const provider = String(form.get("provider") ?? "").trim().toLowerCase();
    if (!["stripe", "paypal", "wise"].includes(provider)) return NextResponse.json({ error: "Unsupported provider." }, { status: 400 });

    const supabase = await createClient();
    const { data: claimsData } = await supabase.auth.getClaims();
    if (!claimsData?.claims?.sub) return NextResponse.redirect(new URL("/login", request.url), 303);
    const { data: authorized, error: authorizationError } = await supabase.rpc("authorize_platform_billing_configuration");
    if (authorizationError || !authorized) return NextResponse.json({ error: "Platform admin MFA/AAL2 is required." }, { status: 403 });

    let livemode = false;
    let externalAccountId: string | null = null;
    let externalProfileId: string | null = null;
    let capabilities: string[] = [];

    if (provider === "stripe") {
      const config = getStripeConfig();
      const account = await stripeGet("/account");
      externalAccountId = stripeId(account.id);
      livemode = config.livemode;
      capabilities = ["checkout", "subscriptions", "portal", "invoices", "refunds", "disputes", "payouts", "webhooks"];
    } else if (provider === "paypal") {
      const config = getPayPalConfig();
      await getPayPalAccessToken();
      livemode = config.livemode;
      capabilities = ["checkout", "subscriptions", "invoices", "refunds", "disputes", "webhooks"];
    } else {
      const config = getWiseConfig();
      const verified = await verifyWiseConnection();
      livemode = verified.livemode;
      externalProfileId = config.profileId;
      capabilities = ["payouts", "transfers", "webhooks"];
    }

    const service = getServiceSupabase();
    const { error: connectionError } = await service.rpc("upsert_payment_provider_connection", {
      provider_key: provider,
      livemode,
      external_account_id: externalAccountId,
      external_profile_id: externalProfileId,
      connection_status: "verified",
      capabilities,
      error_code: null,
    });
    if (connectionError) throw new Error("Provider credentials were valid but Genithm connection state could not be recorded.");

    const target = new URL("/dashboard/admin/billing/payments/setup", request.url);
    target.searchParams.set("provider", provider);
    target.searchParams.set("verified", "1");
    return NextResponse.redirect(target, 303);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to verify payment provider.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
