"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

async function requireUser() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub) redirect("/login");
  return supabase;
}

export async function requestAiPlan(formData: FormData) {
  const supabase = await requireUser();
  const projectId = String(formData.get("project_id") ?? "").trim();
  const conversationId = String(formData.get("conversation_id") ?? "").trim() || null;
  const userMessage = String(formData.get("user_message") ?? "").trim();

  if (!projectId || userMessage.length < 1 || userMessage.length > 8000) {
    redirect("/dashboard/ai?error=Choose%20a%20project%20and%20enter%20a%20request%20between%201%20and%208000%20characters.");
  }

  const { data, error } = await supabase.rpc("request_ai_plan", {
    project_id: projectId,
    conversation_id: conversationId,
    user_message: userMessage,
  });
  const row = data?.[0];
  if (error || !row?.conversation_id) {
    redirect(`/dashboard/ai?error=${encodeURIComponent("Could not queue the AI planning request. Check project access or wait for active planning requests to finish.")}`);
  }

  revalidatePath("/dashboard/ai");
  redirect(`/dashboard/ai/${row.conversation_id}`);
}

export async function approveAiPlan(formData: FormData) {
  const supabase = await requireUser();
  const planRequestId = String(formData.get("plan_request_id") ?? "").trim();
  const conversationId = String(formData.get("conversation_id") ?? "").trim();
  if (!planRequestId || !conversationId) redirect("/dashboard/ai?error=AI%20plan%20approval%20request%20is%20invalid.");

  const { data, error } = await supabase.rpc("approve_ai_plan", { plan_request_id: planRequestId });
  const dispatched = data?.[0];
  if (error || !dispatched?.resource_id) {
    redirect(`/dashboard/ai/${conversationId}?error=${encodeURIComponent("The plan could not be approved. It may no longer be ready, or its referenced project resources may have changed.")}`);
  }

  revalidatePath(`/dashboard/ai/${conversationId}`);
  if (dispatched.resource_type === "scientific_job") redirect(`/dashboard/scientific-jobs/${dispatched.resource_id}`);
  if (dispatched.resource_type === "protein_annotation_job") redirect(`/dashboard/protein-annotations/${dispatched.resource_id}`);
  redirect(`/dashboard/ai/${conversationId}`);
}

export async function requestAiInterpretation(formData: FormData) {
  const supabase = await requireUser();
  const planRequestId = String(formData.get("plan_request_id") ?? "").trim();
  const conversationId = String(formData.get("conversation_id") ?? "").trim();
  if (!planRequestId || !conversationId) redirect("/dashboard/ai?error=AI%20interpretation%20request%20is%20invalid.");

  const { data, error } = await supabase.rpc("request_ai_interpretation", { plan_request_id: planRequestId });
  if (error || !data) {
    redirect(`/dashboard/ai/${conversationId}?error=${encodeURIComponent("The authoritative result is not ready or eligible for evidence-grounded interpretation.")}`);
  }

  revalidatePath(`/dashboard/ai/${conversationId}`);
  redirect(`/dashboard/ai/${conversationId}`);
}
