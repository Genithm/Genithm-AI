import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { getStripeConfig, safeReturnOrigin, stripeFormRequest, stripeObject } from "@/lib/stripe-server";

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const organizationId = String(form.get("organizationId") ?? "").trim();
    if (!organizationId) return NextResponse.json({ error: "Organization is required." }, { status: 400 });

    const supabase = await createClient();
    const { data: claimsData } = await supabase.auth.getClaims();
    if (!claimsData?.claims?.sub) return NextResponse.redirect(new URL("/login", request.url), 303);

    const { livemode } = getStripeConfig();
    const { data: rawContext, error } = await supabase.rpc("get_billing_portal_context", {
      organization_id: organizationId,
      livemode,
    });
    if (error) return NextResponse.json({ error: "Billing management is not available for this organization." }, { status: 403 });
    const context = stripeObject(rawContext);
    const customerId = context && typeof context.provider_customer_id === "string" ? context.provider_customer_id : null;
    if (!customerId) return NextResponse.json({ error: "Stripe customer mapping is not configured." }, { status: 409 });

    const origin = safeReturnOrigin(request.url);
    const portal = await stripeFormRequest("/billing_portal/sessions", {
      customer: customerId,
      return_url: `${origin}/dashboard/billing?organization=${encodeURIComponent(organizationId)}`,
    });
    const portalUrl = typeof portal.url === "string" ? portal.url : null;
    if (!portalUrl) throw new Error("Stripe billing portal returned no redirect URL");
    return NextResponse.redirect(portalUrl, 303);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to open billing management.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
