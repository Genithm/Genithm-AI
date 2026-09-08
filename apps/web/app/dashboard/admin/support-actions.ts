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

async function requireAdminSession() {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (!claimsData?.claims?.sub) redirect("/login");

  const { data: isPlatformAdmin, error } = await supabase.rpc("is_platform_admin");
  if (error || !isPlatformAdmin) redirect("/dashboard");
  return supabase;
}

export async function createPlatformSupportCase(formData: FormData) {
  const supabase = await requireAdminSession();

  const organizationId = String(formData.get("organization_id") ?? "").trim();
  const targetUserId = String(formData.get("target_user_id") ?? "").trim() || null;
  const targetProjectId = String(formData.get("target_project_id") ?? "").trim() || null;
  const category = String(formData.get("category") ?? "other").trim();
  const title = String(formData.get("title") ?? "").trim();
  const initialNote = String(formData.get("initial_note") ?? "").trim();
  const exactEmail = String(formData.get("exact_email") ?? "").trim();

  if (!organizationId || title.length < 3 || initialNote.length < 3) {
    redirect(adminHref({ email: exactEmail, organization: organizationId, error: "Organization, title, and support note are required." }));
  }

  const { data: supportCaseId, error } = await supabase.rpc("create_platform_support_case", {
    organization_id: organizationId,
    target_user_id: targetUserId,
    target_project_id: targetProjectId,
    category,
    title,
    initial_note: initialNote,
  });

  if (error || !supportCaseId) {
    const message = error?.message?.includes("aal2")
      ? "This support action requires an AAL2/MFA-authenticated admin session."
      : "Support case could not be created.";
    redirect(adminHref({ email: exactEmail, organization: organizationId, error: message }));
  }

  revalidatePath("/dashboard/admin");
  redirect(adminHref({ email: exactEmail, organization: organizationId, success: "Support case created and audit-recorded." }));
}

export async function resolvePlatformSupportCase(formData: FormData) {
  const supabase = await requireAdminSession();

  const supportCaseId = String(formData.get("support_case_id") ?? "").trim();
  const resolutionNote = String(formData.get("resolution_note") ?? "").trim();
  const organizationId = String(formData.get("organization_id") ?? "").trim();
  const exactEmail = String(formData.get("exact_email") ?? "").trim();

  if (!supportCaseId || resolutionNote.length < 3) {
    redirect(adminHref({ email: exactEmail, organization: organizationId, error: "A resolution note is required." }));
  }

  const { data: resolvedId, error } = await supabase.rpc("resolve_platform_support_case", {
    support_case_id: supportCaseId,
    resolution_note: resolutionNote,
  });

  if (error || !resolvedId) {
    const message = error?.message?.includes("aal2")
      ? "This support action requires an AAL2/MFA-authenticated admin session."
      : "Support case could not be resolved.";
    redirect(adminHref({ email: exactEmail, organization: organizationId, error: message }));
  }

  revalidatePath("/dashboard/admin");
  redirect(adminHref({ email: exactEmail, organization: organizationId, success: "Support case resolved and audit-recorded." }));
}
