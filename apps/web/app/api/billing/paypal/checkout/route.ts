import { NextResponse, type NextRequest } from "next/server";

import { getPayPalConfig, paypalLink, paypalRequest } from "@/lib/paypal-server";
import { createClient } from "@/lib/supabase/server";
import { safeReturnOrigin, stripeObject } from "@/lib/stripe-server";

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const organizationId = String(form.get("organizationId") ?? "").trim();
    const priceKey = String(form.get("priceKey") ?? "").trim();
    if (!organizationId || !priceKey) return NextResponse.json({ error: "Organization and price are required." }, { status: 400 });

    const supabase = await createClient();
    const { data: claimsData } = await supabase.auth.getClaims();
    if (!claimsData?.claims?.sub) return NextResponse.redirect(new URL("/login", request.url), 303);

    const { livemode } = getPayPalConfig();
    const { data: rawContext, error } = await (supabase as any).rpc("get_provider_checkout_context", {
      organization_id: organizationId,
      provider_key: "paypal",
      price_key: priceKey,
      livemode,
    });
    if (error) return NextResponse.json({ error: "PayPal checkout is unavailable for this organization/price." }, { status: 403 });
    const context = stripeObject(rawContext);
    const externalPlanId = context && typeof context.external_price_id === "string" ? context.external_price_id : null;
    if (!externalPlanId) return NextResponse.json({ error: "PayPal plan mapping is missing." }, { status: 409 });

    const origin = safeReturnOrigin(request.url);
    const subscription = await paypalRequest("/v1/billing/subscriptions", {
      method: "POST",
      requestId: `genithm-sub-${organizationId}-${priceKey}`,
      body: {
        plan_id: externalPlanId,
        custom_id: organizationId,
        application_context: {
          brand_name: "Genithm",
          user_action: "SUBSCRIBE_NOW",
          return_url: `${origin}/dashboard/billing/payments?paypal=approved&organization=${encodeURIComponent(organizationId)}`,
          cancel_url: `${origin}/dashboard/billing/payments?paypal=cancelled&organization=${encodeURIComponent(organizationId)}`,
        },
      },
    });
    const approvalUrl = paypalLink(subscription, "approve");
    if (!approvalUrl) throw new Error("PayPal subscription response did not include an approval URL");
    return NextResponse.redirect(approvalUrl, 303);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to start PayPal checkout.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
