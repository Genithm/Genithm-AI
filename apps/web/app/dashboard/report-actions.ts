"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export async function requestScientificReport(formData: FormData) {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (!claimsData?.claims?.sub) redirect("/login");

  const sourceJobId = String(formData.get("source_job_id") ?? "").trim();
  if (!sourceJobId) redirect("/dashboard/reports?error=Scientific%20job%20is%20required.");

  const { data: reportId, error } = await supabase.rpc("request_scientific_report", {
    source_job_id: sourceJobId,
  });

  if (error || !reportId) {
    redirect(`/dashboard/scientific-jobs/${sourceJobId}?error=${encodeURIComponent("Could not generate report. The scientific result must be completed and accessible to you.")}`);
  }

  revalidatePath("/dashboard/reports");
  revalidatePath(`/dashboard/scientific-jobs/${sourceJobId}`);
  redirect(`/dashboard/reports/${reportId}`);
}
