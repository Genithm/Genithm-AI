import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { readScienceOperationsOverview } from "@/lib/science-operations-server";

export const dynamic = "force-dynamic";

const HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: HEADERS });
}

/**
 * Privileged, read-only operations health.
 * Never trust caller-supplied IDs/roles and never return raw service errors,
 * underlying queue records, database rows or application secrets.
 */
export async function GET() {
  try {
    const user = await createClient();
    const { data: claims, error: claimsError } = await user.auth.getClaims();
    if (claimsError || !claims?.claims?.sub) {
      return json({ error: "Authentication required" }, 401);
    }

    const { data: admin, error: entitlementError } = await user.rpc("is_platform_admin");
    if (entitlementError || admin !== true) {
      return json({ error: "Not found" }, 404);
    }

    const overview = await readScienceOperationsOverview();
    return json(overview, overview.status.health === "unavailable" ? 503 : 200);
  } catch {
    return json({ error: "Operations status unavailable" }, 503);
  }
}
