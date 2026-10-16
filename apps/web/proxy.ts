import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { updateSession } from "@/lib/supabase/proxy";

// The optional Codespaces sample workbench is available without Supabase.
// Even in fixture mode, users must be able to discover the real login/signup
// routes and see clear full-preview setup instructions. Production is unaffected.
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
    if (pathname === "/" || pathname === "/preview" ||
        pathname === "/login" || pathname === "/signup" ||
        pathname === "/api/health" || pathname.startsWith("/legal/")) {
      return NextResponse.next();
    }

    // Protected research routes lead to visible, truthful authentication
    // setup, NEVER to the sample-only research workbench.
    const setupUrl = request.nextUrl.clone();
    setupUrl.pathname = "/login";
    setupUrl.search = "?setup=1";
    return NextResponse.redirect(setupUrl);
  }

  return updateSession(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
