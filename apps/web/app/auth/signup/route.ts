import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";

function redirectWithMessage(request: NextRequest, pathname: string, key: "error" | "message", value: string) {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  url.search = "";
  url.searchParams.set(key, value);
  return NextResponse.redirect(url, 303);
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const passwordConfirmation = String(formData.get("password_confirmation") ?? "");

  if (!email || !email.includes("@") || password.length < 10) {
    return redirectWithMessage(request, "/signup", "error", "Please enter a valid email and a password of at least 10 characters.");
  }

  if (password !== passwordConfirmation) {
    return redirectWithMessage(request, "/signup", "error", "Passwords do not match.");
  }

  const confirmUrl = new URL("/auth/confirm", request.nextUrl.origin).toString();
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: confirmUrl },
  });

  if (error) {
    return redirectWithMessage(request, "/signup", "error", "Account creation failed. Please try again.");
  }

  if (data.session) {
    const dashboardUrl = request.nextUrl.clone();
    dashboardUrl.pathname = "/dashboard";
    dashboardUrl.search = "";
    return NextResponse.redirect(dashboardUrl, 303);
  }

  return redirectWithMessage(request, "/login", "message", "Account created. Check your email to confirm it, then sign in.");
}
