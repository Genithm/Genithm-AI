"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

function readCredentials(formData: FormData, errorPath: "/login" | "/signup") {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!email || !email.includes("@") || password.length < 10) {
    redirect(`${errorPath}?error=${encodeURIComponent("Please enter a valid email and a password of at least 10 characters.")}`);
  }
  return { email, password };
}

async function getTrustedAppOrigin() {
  const configured = process.env.GENITHM_APP_URL?.trim().replace(/\/$/, "");
  if (configured) return configured;

  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  if (!host) return undefined;
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
  return `${protocol}://${host}`;
}

export async function login(formData: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(readCredentials(formData, "/login"));
  if (error) redirect(`/login?error=${encodeURIComponent("Sign in failed. Check your credentials or confirm your email.")}`);
  redirect("/dashboard");
}

export async function signup(formData: FormData) {
  const supabase = await createClient();
  const credentials = readCredentials(formData, "/signup");
  const passwordConfirmation = String(formData.get("password_confirmation") ?? "");
  if (credentials.password !== passwordConfirmation) {
    redirect(`/signup?error=${encodeURIComponent("Passwords do not match.")}`);
  }

  const origin = await getTrustedAppOrigin();
  const { data, error } = await supabase.auth.signUp({
    ...credentials,
    options: origin ? { emailRedirectTo: `${origin}/auth/confirm` } : undefined,
  });
  if (error) redirect(`/signup?error=${encodeURIComponent("Account creation failed. Please try again.")}`);

  if (data.session) redirect("/dashboard");
  redirect(`/login?message=${encodeURIComponent("Account created. Check your email to confirm it, then sign in.")}`);
}
