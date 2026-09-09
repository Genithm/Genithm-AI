"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

function adminHref(params: Record<string, string | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  const query = search.toString();
  return query ? `/dashboard/admin?${query}` : "/dashboard/admin";
}

async function requirePlatformAdmin() {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) redirect("/login");

  const { data: allowed, error } = await supabase.rpc("is_platform_admin");
  if (error || !allowed) redirect("/dashboard");

  return supabase;
}

export async function grantPlatformAdmin(formData: FormData) {
  const supabase = await requirePlatformAdmin();

  const targetUserId = String(formData.get("target_user_id") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();

  if (!targetUserId || reason.length < 3) {
    redirect(adminHref({ error: "A target user and reason are required." }));
  }

  const { error } = await supabase.rpc("grant_platform_admin", {
    target_user_id: targetUserId,
    reason,
  });

  if (error) {
    redirect(adminHref({ error: error.message.includes("aal2") ? "AAL2/MFA is required." : "Admin grant failed." }));
  }

  revalidatePath("/dashboard/admin");
  redirect(adminHref({ success: "Platform admin entitlement granted and audited." }));
}

export async function revokePlatformAdmin(formData: FormData) {
  const supabase = await requirePlatformAdmin();

  const targetUserId = String(formData.get("target_user_id") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();

  if (!targetUserId || reason.length < 3) {
    redirect(adminHref({ error: "A target user and reason are required." }));
  }

  const { error } = await supabase.rpc("revoke_platform_admin", {
    target_user_id: targetUserId,
    reason,
  });

  if (error) {
    redirect(adminHref({ error: error.message.includes("aal2") ? "AAL2/MFA is required." : "Admin revoke failed." }));
  }

  revalidatePath("/dashboard/admin");
  redirect(adminHref({ success: "Platform admin entitlement revoked and audited." }));
}
