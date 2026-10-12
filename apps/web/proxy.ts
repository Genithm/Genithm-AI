import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { updateSession } from "@/lib/supabase/proxy";

// Only the explicitly marked local Codespaces *development* environment may
// show the public demo without Supabase. Authenticated routes are blocked until
// real development credentials are configured. Production is unaffected.
export async function proxy(request: NextRequest) {
  const codespacesDemo =
    process.env.NODE_ENV === "development" &&
    process.env.GENITHM_CODESPACES_PREVIEW === "1";
  const hasPublicCredentials =
    Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL) &&
    Boolean(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);

  // The local science API has its own development-only validation and
  // is never a Supabase-authenticated customer endpoint.
  if (codespacesDemo && request.nextUrl.pathname === "/api/dev-science") {
    return NextResponse.next();
  }

  if (codespacesDemo && !hasPublicCredentials) {
    const pathname = request.nextUrl.pathname;
    if (pathname === "/" || pathname === "/preview" || pathname.startsWith("/legal/")) {
      return NextResponse.next();
    }

    const setupUrl = request.nextUrl.clone();
    setupUrl.pathname = "/preview";
    setupUrl.search = "?setup=1";
    return NextResponse.redirect(setupUrl);
  }

  return updateSession(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
