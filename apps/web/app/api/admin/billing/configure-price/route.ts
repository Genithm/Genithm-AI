import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { getServiceSupabase, getStripeConfig, stripeFormRequest, stripeId } from "@/lib/stripe-server";

const PLAN_NAMES: Record<string, string> = {
  researcher: "Genithm Researcher",
  professional: "Genithm Professional",
  team: "Genithm Team",
};

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const planKey = String(form.get("planKey") ?? "").trim().toLowerCase();
    const interval = String(form.get("interval") ?? "month").trim().toLowerCase();
    const currency = String(form.get("currency") ?? "USD").trim().toUpperCase();
    const amountMinor = Number.parseInt(String(form.get("amountMinor") ?? ""), 10);
    if (!PLAN_NAMES[planKey]) return NextResponse.json({ error: "Unsupported subscription plan." }, { status: 400 });
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) return NextResponse.json({ error: "Price must be a positive integer in minor currency units." }, { status: 400 });
    if (!/^[A-Z]{3}$/.test(currency)) return NextResponse.json({ error: "Currency must be a three-letter ISO code." }, { status: 400 });
    if (!['month', 'year'].includes(interval)) return NextResponse.json({ error: "Billing interval must be month or year." }, { status: 400 });

    const supabase = await createClient();
    const { data: claimsData } = await supabase.auth.getClaims();
    if (!claimsData?.claims?.sub) return NextResponse.redirect(new URL("/login", request.url), 303);
    const { data: authorized, error: authorizationError } = await supabase.rpc("authorize_platform_billing_configuration");
    if (authorizationError || !authorized) return NextResponse.json({ error: "Platform admin MFA/AAL2 is required." }, { status: 403 });

    const { livemode } = getStripeConfig();
    const product = await stripeFormRequest("/products", {
      name: PLAN_NAMES[planKey],
      active: true,
      "metadata[genithm_plan_key]": planKey,
    }, { idempotencyKey: `genithm-product-${planKey}-${livemode ? "live" : "test"}` });
    const productId = stripeId(product.id);
    if (!productId) throw new Error("Stripe product creation returned no product ID");

    const priceKey = `${planKey}_${interval}_${currency.toLowerCase()}`;
    const lookupKey = `genithm_${planKey}_${interval}_${currency.toLowerCase()}_${amountMinor}`;
    const price = await stripeFormRequest("/prices", {
      product: productId,
      currency: currency.toLowerCase(),
      unit_amount: amountMinor,
      "recurring[interval]": interval,
      "recurring[interval_count]": 1,
      lookup_key: lookupKey,
      "metadata[genithm_plan_key]": planKey,
      "metadata[genithm_price_key]": priceKey,
    }, { idempotencyKey: `genithm-price-${lookupKey}-${livemode ? "live" : "test"}` });
    const priceId = stripeId(price.id);
    if (!priceId) throw new Error("Stripe price creation returned no price ID");

    const service = getServiceSupabase();
    const { error: mappingError } = await service.rpc("configure_stripe_price_mapping", {
      plan_key: planKey,
      price_key: priceKey,
      currency,
      unit_amount_minor: amountMinor,
      billing_interval: interval,
      interval_count: 1,
      livemode,
      provider_product_id: productId,
      provider_price_id: priceId,
      lookup_key: lookupKey,
    });
    if (mappingError) throw new Error("Stripe price was created but Genithm mapping failed; retry configuration with the same values to reconcile safely.");

    return NextResponse.redirect(new URL("/dashboard/admin/billing/payments?price=configured", request.url), 303);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to configure Stripe price.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
