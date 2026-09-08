import { NextResponse, type NextRequest } from "next/server";

import { paypalRequest, paypalText, getPayPalConfig } from "@/lib/paypal-server";
import { createClient } from "@/lib/supabase/server";
import { getServiceSupabase, getStripeConfig, stripeFormRequest, stripeId } from "@/lib/stripe-server";

const PLAN_NAMES: Record<string, string> = {
  researcher: "Genithm Researcher",
  professional: "Genithm Professional",
  team: "Genithm Team",
};

function amountDecimal(amountMinor: number) {
  return (amountMinor / 100).toFixed(2);
}

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const provider = String(form.get("provider") ?? "stripe").trim().toLowerCase();
    const planKey = String(form.get("planKey") ?? "").trim().toLowerCase();
    const interval = String(form.get("interval") ?? "month").trim().toLowerCase();
    const currency = String(form.get("currency") ?? "USD").trim().toUpperCase();
    const amountMinor = Number.parseInt(String(form.get("amountMinor") ?? ""), 10);
    if (!PLAN_NAMES[planKey]) return NextResponse.json({ error: "Unsupported subscription plan." }, { status: 400 });
    if (!['stripe', 'paypal'].includes(provider)) return NextResponse.json({ error: "This provider does not support recurring plan configuration." }, { status: 400 });
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) return NextResponse.json({ error: "Price must be a positive integer in minor currency units." }, { status: 400 });
    if (!/^[A-Z]{3}$/.test(currency)) return NextResponse.json({ error: "Currency must be a three-letter ISO code." }, { status: 400 });
    if (!['month', 'year'].includes(interval)) return NextResponse.json({ error: "Billing interval must be month or year." }, { status: 400 });

    const supabase = await createClient();
    const { data: claimsData } = await supabase.auth.getClaims();
    if (!claimsData?.claims?.sub) return NextResponse.redirect(new URL("/login", request.url), 303);
    const { data: authorized, error: authorizationError } = await supabase.rpc("authorize_platform_billing_configuration");
    if (authorizationError || !authorized) return NextResponse.json({ error: "Platform admin MFA/AAL2 is required." }, { status: 403 });

    const priceKey = `${planKey}_${interval}_${currency.toLowerCase()}`;
    const service = getServiceSupabase();

    if (provider === "stripe") {
      const { livemode } = getStripeConfig();
      const product = await stripeFormRequest("/products", {
        name: PLAN_NAMES[planKey],
        active: true,
        "metadata[genithm_plan_key]": planKey,
      }, { idempotencyKey: `genithm-product-${planKey}-${livemode ? "live" : "test"}` });
      const productId = stripeId(product.id);
      if (!productId) throw new Error("Stripe product creation returned no product ID");

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

      const { error: stripeMappingError } = await service.rpc("configure_stripe_price_mapping", {
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
      if (stripeMappingError) throw new Error("Stripe price was created but Stripe compatibility mapping failed.");

      const { error: genericMappingError } = await service.rpc("configure_provider_plan_mapping", {
        provider_key: "stripe",
        livemode,
        plan_key: planKey,
        price_key: priceKey,
        currency,
        unit_amount_minor: amountMinor,
        billing_interval: interval,
        interval_count: 1,
        external_product_id: productId,
        external_price_id: priceId,
      });
      if (genericMappingError) throw new Error("Stripe price was created but provider-neutral mapping failed.");
    } else {
      const { livemode } = getPayPalConfig();
      const product = await paypalRequest("/v1/catalogs/products", {
        method: "POST",
        requestId: `genithm-${planKey}-${livemode ? "live" : "sandbox"}`,
        body: {
          name: PLAN_NAMES[planKey],
          description: `${PLAN_NAMES[planKey]} subscription`,
          type: "SERVICE",
          category: "SOFTWARE",
        },
      });
      const productId = paypalText(product.id);
      if (!productId) throw new Error("PayPal product creation returned no product ID");

      const paypalPlan = await paypalRequest("/v1/billing/plans", {
        method: "POST",
        requestId: `genithm-${planKey}-${interval}-${currency}-${amountMinor}-${livemode ? "live" : "sandbox"}`,
        body: {
          product_id: productId,
          name: `${PLAN_NAMES[planKey]} ${interval}`,
          description: `${PLAN_NAMES[planKey]} billed every ${interval}`,
          status: "ACTIVE",
          billing_cycles: [{
            frequency: { interval_unit: interval === "year" ? "YEAR" : "MONTH", interval_count: 1 },
            tenure_type: "REGULAR",
            sequence: 1,
            total_cycles: 0,
            pricing_scheme: { fixed_price: { value: amountDecimal(amountMinor), currency_code: currency } },
          }],
          payment_preferences: {
            auto_bill_outstanding: true,
            payment_failure_threshold: 3,
          },
        },
      });
      const externalPlanId = paypalText(paypalPlan.id);
      if (!externalPlanId) throw new Error("PayPal billing plan creation returned no plan ID");

      const { error: mappingError } = await service.rpc("configure_provider_plan_mapping", {
        provider_key: "paypal",
        livemode,
        plan_key: planKey,
        price_key: priceKey,
        currency,
        unit_amount_minor: amountMinor,
        billing_interval: interval,
        interval_count: 1,
        external_product_id: productId,
        external_price_id: externalPlanId,
      });
      if (mappingError) throw new Error("PayPal plan was created but Genithm mapping failed; retry with the same commercial values after reviewing provider state.");
    }

    return NextResponse.redirect(new URL(`/dashboard/admin/billing/payments?price=configured&provider=${provider}`, request.url), 303);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to configure provider price.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
