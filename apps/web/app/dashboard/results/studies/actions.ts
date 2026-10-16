"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { parseComparisonIds } from "@/lib/verified-scientific-comparison";

const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;

function savedStudyError(message: string): never {
  redirect("/dashboard/results/studies?error=" + encodeURIComponent(message));
}

export async function saveScientificComparisonStudy(form: FormData) {
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId || authError) redirect("/login");

  const title = String(form.get("title") ?? "").trim();
  const description = String(form.get("description") ?? "").trim();
  const ids = parseComparisonIds(String(form.get("job_ids") ?? ""));
  const supplied = String(form.get("verified_sha256") ?? "").split(",");
  if (!ids || title.length < 3 || title.length > 160 ||
      description.length > 2000 || supplied.length !== ids.length ||
      !supplied.every(hash => SHA256.test(hash))) {
    savedStudyError("Enter a study title and verify two to four compatible results before saving.");
  }

  const { data: jobs, error } = await supabase.from("scientific_jobs")
    .select("id,organization_id,project_id,requested_by,job_type,status,result_sha256")
    .eq("requested_by", userId).in("id", ids);
  if (error || !jobs || jobs.length !== ids.length) {
    savedStudyError("Some selected analyses cannot be accessed.");
  }
  const byId = new Map(jobs.map(job => [job.id.toLowerCase(),job]));
  const ordered = ids.map(id => byId.get(id.toLowerCase()));
  const first = ordered[0];
  if (!first || !["protein_properties","pairwise_alignment"].includes(first.job_type) ||
      ordered.some((job,index) => !job || job.project_id !== first.project_id ||
        job.organization_id !== first.organization_id || job.job_type !== first.job_type ||
        job.requested_by !== userId || job.status !== "completed" ||
        !job.result_sha256 || job.result_sha256 !== supplied[index])) {
    savedStudyError("Only verified, compatible analyses from one project can be saved. Reload the results if evidence changed.");
  }
  // Trigger independently derives the exact ordered hashes and tool versions.
  // Browser-supplied verification data is used solely to detect mismatches;
  // it is NEVER inserted as stored evidence.
  const { data: saved, error: insertError } = await supabase.from("scientific_comparison_studies")
    .insert({
      project_id: first.project_id,
      created_by: userId,
      job_type: first.job_type as "protein_properties" | "pairwise_alignment",
      job_ids: ids,
      title,
      description,
    }).select("id").maybeSingle();
  if (insertError || !saved) savedStudyError("Could not save this study. Check source permissions and try again.");
  revalidatePath("/dashboard/results/studies");
  redirect("/dashboard/results/studies/" + saved.id + "?saved=1");
}

export async function updateScientificComparisonStudy(form: FormData) {
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId || authError) redirect("/login");
  const id = String(form.get("study_id") ?? "");
  const title = String(form.get("title") ?? "").trim();
  const description = String(form.get("description") ?? "").trim();
  if (!UUID.test(id) || title.length < 3 || title.length > 160 || description.length > 2000) {
    savedStudyError("The study title or description is invalid.");
  }
  const { data, error } = await supabase.from("scientific_comparison_studies")
    .update({ title, description }).eq("id", id).eq("created_by",userId)
    .select("id").maybeSingle();
  if (error || !data) savedStudyError("Study details could not be updated.");
  revalidatePath("/dashboard/results/studies");
  revalidatePath("/dashboard/results/studies/"+id);
  redirect("/dashboard/results/studies/"+id+"?updated=1");
}

export async function deleteScientificComparisonStudy(form: FormData) {
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId || authError) redirect("/login");
  const id = String(form.get("study_id") ?? "");
  if (!UUID.test(id)) savedStudyError("That saved study is unavailable.");
  const { data,error } = await supabase.from("scientific_comparison_studies")
    .delete().eq("id",id).eq("created_by",userId).select("id").maybeSingle();
  if (error || !data) savedStudyError("Could not delete the saved study.");
  revalidatePath("/dashboard/results/studies");
  redirect("/dashboard/results/studies?deleted=1");
}
