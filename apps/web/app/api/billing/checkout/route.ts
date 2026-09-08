import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { getServiceSupabase, getStripeConfig, safeReturnOrigin, stripeFormRequest, stripeId, stripeObject } from "@/lib/stripe-server";

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const organizationId = String(form.get("organizationId") ?? "").trim();
    const priceKey = String(form.get("priceKey") ?? "").trim();
    if (!organizationId || !priceKey) return NextResponse.json({ error: "Organization and price are required." }, { status: 400 });

    const supabase = await createClient();
    const { data: claimsData } = await supabase.auth.getClaims();
    const userId = typeof claimsData?.claims?.sub === "string" ? claimsData.claims.sub : null;
    if (!userId) return NextResponse.redirect(new URL("/login", request.url), 303);

    const { livemode } = getStripeConfig();
    const { data: rawContext, error: contextError } = await supabase.rpc("get_billing_checkout_context", {
      organization_id: organizationId,
      price_key: priceKey,
      livemode,
    });
    if (contextError) return NextResponse.json({ error: "Billing checkout is not available for this organization." }, { status: 403 });
    const context = stripeObject(rawContext);
    if (!context) return NextResponse.json({ error: "Billing checkout configuration is incomplete." }, { status: 409 });

    let customerId = typeof context.provider_customer_id === "string" ? context.provider_customer_id : null;
    const service = getServiceSupabase();
    if (!customerId) {
      const { data: organization } = await supabase.from("organizations").select("name").eq("id", organizationId).maybeSingle();
      const email = typeof claimsData?.claims?.email === "string" ? claimsData.claims.email : undefined;
      const customer = await stripeFormRequest("/customers", {
        email,
        description: organization?.name ? `Genithm organization: ${organization.name}` : "Genithm organization",
        "metadata[genithm_organization_id]": organizationId,
      }, { idempotencyKey: `genithm-customer-${organizationId}-${livemode ? "live" : "test"}` });
      customerId = stripeId(customer.id);
      if (!customerId) throw new Error("Stripe customer creation returned no customer ID");
      const { error: syncError } = await service.rpc("sync_stripe_customer", {
        organization_id: organizationId,
        livemode,
        provider_customer_id: customerId,
      });
      if (syncError) throw new Error("Unable to persist Stripe customer mapping");
    }

    const providerPriceId = typeof context.provider_price_id === "string" ? context.provider_price_id : null;
    if (!providerPriceId) return NextResponse.json({ error: "Selected price is not mapped to Stripe." }, { status: 409 });

    const origin = safeReturnOrigin(request.url);
    const returnQuery = `organization=${encodeURIComponent(organizationId)}`;
    const session = await stripeFormRequest("/checkout/sessions", {
      mode: "subscription",
      customer: customerId,
      client_reference_id: organizationId,
      "metadata[genithm_organization_id]": organizationId,
      "subscription_data[metadata][genithm_organization_id]": organizationId,
      "line_items[0][price]": providerPriceId,
      "line_items[0][quantity]": 1,
      success_url: `${origin}/dashboard/billing?${returnQuery}&checkout=success`,
      cancel_url: `${origin}/dashboard/billing?${returnQuery}&checkout=cancelled`,
      allow_promotion_codes: true,
    }, { idempotencyKey: `genithm-checkout-${organizationId}-${priceKey}-${randomUUID()}` });

    const checkoutUrl = typeof session.url === "string" ? session.url : null;
    if (!checkoutUrl) throw new Error("Stripe Checkout returned no redirect URL");
    return NextResponse.redirect(checkoutUrl, 303);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to start billing checkout.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
