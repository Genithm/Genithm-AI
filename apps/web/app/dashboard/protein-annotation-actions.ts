"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export async function requestProteinAnnotation(formData: FormData) {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (!claimsData?.claims?.sub) redirect("/login");

  const projectId = String(formData.get("project_id") ?? "").trim();
  const sequenceUploadId = String(formData.get("sequence_upload_id") ?? "").trim();
  if (!projectId || !sequenceUploadId) {
    redirect("/dashboard?error=Select%20an%20eligible%20NCBI-origin%20protein%20for%20evidence-backed%20annotation.");
  }

  const { data: jobId, error } = await supabase.rpc("request_protein_annotation", {
    project_id: projectId,
    sequence_upload_id: sequenceUploadId,
  });

  if (error || !jobId) {
    redirect(`/dashboard?error=${encodeURIComponent("Could not queue protein annotation. V1 requires a ready single-record protein produced by a successful NCBI protein retrieval.")}`);
  }

  revalidatePath("/dashboard");
  redirect(`/dashboard/protein-annotations/${jobId}`);
}
