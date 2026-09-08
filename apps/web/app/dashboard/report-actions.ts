"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

function sourcePath(resourceType: string, resourceId: string) {
  if (resourceType === "scientific_job") return `/dashboard/scientific-jobs/${resourceId}`;
  if (resourceType === "protein_annotation_job") return `/dashboard/protein-annotations/${resourceId}`;
  return "/dashboard";
}

export async function requestAuthoritativeReport(formData: FormData) {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (!claimsData?.claims?.sub) redirect("/login");

  const resourceType = String(formData.get("source_resource_type") ?? "").trim();
  const resourceId = String(formData.get("source_resource_id") ?? "").trim();
  if (!resourceType || !resourceId) redirect("/dashboard/reports?error=Report%20source%20is%20required.");

  const { data: reportId, error } = await supabase.rpc("request_authoritative_report", {
    source_resource_type: resourceType,
    source_resource_id: resourceId,
  });

  if (error || !reportId) {
    redirect(`${sourcePath(resourceType, resourceId)}?error=${encodeURIComponent("Could not generate report. The authoritative result must be finalized and accessible to you.")}`);
  }

  revalidatePath("/dashboard/reports");
  revalidatePath(sourcePath(resourceType, resourceId));
  redirect(`/dashboard/reports/${reportId}`);
}

export async function requestScientificReport(formData: FormData) {
  const sourceJobId = String(formData.get("source_job_id") ?? "").trim();
  const delegated = new FormData();
  delegated.set("source_resource_type", "scientific_job");
  delegated.set("source_resource_id", sourceJobId);
  return requestAuthoritativeReport(delegated);
}
