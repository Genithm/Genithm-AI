/** GET only: actual user-scoped, checksum-reverified research artifacts. */
import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { authenticatedRiceResult } from "@/lib/public-rice-gwas-runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const db = await createClient();
  const { data, error } = await db.auth.getClaims();
  const owner = data?.claims?.sub;
  if (error || !owner) return Response.json({ error: "Sign in to download your study files." }, { status: 401 });
  const run = request.nextUrl.searchParams.get("run") || "";
  const file = request.nextUrl.searchParams.get("file") || "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(run))
    return Response.json({ error: "Invalid study reference." }, { status: 422 });
  try {
    const { bytes, contentType } = await authenticatedRiceResult(owner,run,file);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": contentType + (contentType.startsWith("text/")||contentType==="application/json" ? "; charset=utf-8" : ""),
        "Content-Disposition": `attachment; filename="genithm-rice-${file}"`,
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "X-Genithm-Result-Scope": "authenticated-ephemeral-research-result",
      },
    });
  } catch {
    return Response.json({ error: "Study result is unavailable, expired, or not owned by this account." }, { status:404, headers:{ "Cache-Control":"no-store" } });
  }
}
