"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

function readCredentials(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!email || !email.includes("@") || password.length < 10) {
    redirect("/login?error=Please%20enter%20a%20valid%20email%20and%20a%20password%20of%20at%20least%2010%20characters.");
  }
  return { email, password };
}

export async function login(formData: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(readCredentials(formData));
  if (error) redirect(`/login?error=${encodeURIComponent("Sign in failed. Check your credentials or confirm your email.")}`);
  redirect("/dashboard");
}

export async function signup(formData: FormData) {
  const supabase = await createClient();
  const credentials = readCredentials(formData);
  const origin = String(formData.get("origin") ?? "");
  const { error } = await supabase.auth.signUp({
    ...credentials,
    options: origin ? { emailRedirectTo: `${origin}/auth/confirm` } : undefined,
  });
  if (error) redirect(`/login?error=${encodeURIComponent("Account creation failed. Please try again.")}`);
  redirect("/login?message=Check%20your%20email%20to%20confirm%20your%20account.");
}
