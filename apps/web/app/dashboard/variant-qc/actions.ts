"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { MAX_VCF_RECORDS, validateVcfQcSummary, VCF_QC_VERSION } from "@/lib/vcf-quality-control";
import type { Json } from "@/lib/report-database.types";

const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const SHA = /^[0-9a-f]{64}$/;

export async function saveVariantQcSnapshot(form: FormData): Promise<{ id?: string; error?: string }> {
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (authError || !userId) return { error: "Please sign in again." };

  const projectId = String(form.get("project_id") ?? "");
  const title = String(form.get("title") ?? "").trim();
  const sha = String(form.get("source_sha256") ?? "");
  const summaryText = String(form.get("summary") ?? "");
  if (!UUID.test(projectId) || title.length<3 || title.length>160 ||
      !SHA.test(sha) || summaryText.length>12000) {
    return { error:"Choose an accessible project and enter a valid title." };
  }
  let summary: unknown;
  try { summary = JSON.parse(summaryText); } catch { return { error:"Invalid QC summary." }; }
  if (!validateVcfQcSummary(summary) ||
      summary.totalRecords>MAX_VCF_RECORDS ||
      summary.analyzerVersion !== VCF_QC_VERSION) {
    return { error:"QC summary failed structural consistency checks. Run the analysis again." };
  }
  // Only bounded aggregate metrics are stored. No variant rows, sample names,
  // genotype calls or original VCF bytes enter this action.
  // The SHA is browser-computed and explicitly marked unverified by the DB.
  const { data, error } = await supabase.from("variant_qc_snapshots").insert({
    project_id: projectId,
    created_by: userId,
    title,
    source_sha256: sha,
    total_records: summary.totalRecords,
    analyzer_version: VCF_QC_VERSION,
    summary: summary as unknown as Json,
  }).select("id").maybeSingle();
  if (error || !data) return { error: "Could not save QC results. Check research-project access." };
  revalidatePath("/dashboard/variant-qc");
  return { id:data.id };
}

export async function deleteVariantQcSnapshot(form: FormData) {
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (authError || !userId) redirect("/login");
  const id = String(form.get("snapshot_id") ?? "");
  if (!UUID.test(id)) redirect("/dashboard/variant-qc?error=Invalid%20QC%20snapshot");
  const { data, error } = await supabase.from("variant_qc_snapshots")
    .delete().eq("id",id).eq("created_by",userId).select("id").maybeSingle();
  if (error || !data) redirect("/dashboard/variant-qc?error=QC%20snapshot%20not%20deleted");
  revalidatePath("/dashboard/variant-qc");
  redirect("/dashboard/variant-qc?deleted=1");
}
