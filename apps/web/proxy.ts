import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { updateSession } from "@/lib/supabase/proxy";
import { isDesktopWorkspacePath, isMobileResearchClient } from "@/lib/desktop-workspace-policy";

// The optional Codespaces sample workbench is available without Supabase.
// Even in fixture mode, users must be able to discover the real login/signup
// routes and see clear full-preview setup instructions. Production is unaffected.
export async function proxy(request: NextRequest) {
  // Product policy: show phones/tablets a desktop notice, not the research UI.
  // API requests still use their own authentication; this is not access control.
  if (isDesktopWorkspacePath(request.nextUrl.pathname) && isMobileResearchClient(request.headers)) {
    const destination = request.nextUrl.clone();
    destination.pathname = "/desktop-required";
    destination.search = "";
    const response = NextResponse.redirect(destination, request.method === "GET" || request.method === "HEAD" ? 307 : 303);
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("Vary", "User-Agent, Sec-CH-UA-Mobile, Sec-CH-UA-Platform");
    return response;
  }
  if (request.nextUrl.pathname === "/desktop-required") return NextResponse.next();
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
