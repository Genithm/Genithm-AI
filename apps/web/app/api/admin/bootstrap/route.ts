import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/stripe-server";

function bootstrapTarget() {
  const value = process.env.GENITHM_BOOTSTRAP_ADMIN_USER_ID?.trim() ?? "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error("platform_admin_bootstrap_target_not_configured");
  }
  return value;
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;
  const userId = typeof claims?.sub === "string" ? claims.sub : null;
  if (!userId) return NextResponse.redirect(new URL("/login", request.url), 303);

  let targetUserId: string;
  try {
    targetUserId = bootstrapTarget();
  } catch {
    return NextResponse.json({ error: "Platform admin bootstrap is not configured." }, { status: 503 });
  }

  if (userId !== targetUserId) return NextResponse.json({ error: "Bootstrap account mismatch." }, { status: 403 });
  if (claims?.aal !== "aal2") {
    const target = new URL("/admin/bootstrap", request.url);
    target.searchParams.set("error", "MFA/AAL2 verification is required before activation.");
    return NextResponse.redirect(target, 303);
  }

  const { data: aalData, error: aalError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aalError || aalData.currentLevel !== "aal2") {
    const target = new URL("/admin/bootstrap", request.url);
    target.searchParams.set("error", "The current session is not verified at AAL2.");
    return NextResponse.redirect(target, 303);
  }

  const service = getServiceSupabase();
  const { data: bootstrappedUserId, error: bootstrapError } = await service.rpc("bootstrap_first_platform_admin", {
    target_user_id: targetUserId,
    reason: "initial_platform_admin_bootstrap",
  });

  if (bootstrapError || bootstrappedUserId !== targetUserId) {
    const target = new URL("/admin/bootstrap", request.url);
    target.searchParams.set("error", "Platform admin activation was refused by the database safety boundary.");
    return NextResponse.redirect(target, 303);
  }

  return NextResponse.redirect(new URL("/dashboard/admin", request.url), 303);
}
