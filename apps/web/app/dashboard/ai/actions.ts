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


/**
 * One-click, explicitly requested setup for first-time chat users.
 * This creates a private project in an organization the signed-in user may
 * access; never adds a public membership or initiates paid compute.
 */
export async function startChatWorkspace() {
  const supabase = await requireUser();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) redirect("/login");

  const { data: existing } = await supabase
    .from("projects").select("id").eq("status", "active").limit(1);
  if (existing?.length) redirect("/dashboard/ai");

  const { data: orgs, error: orgReadError } = await supabase
    .from("organizations").select("id").order("created_at", { ascending: true }).limit(1);
  if (orgReadError) redirect("/dashboard/ai?error=Could%20not%20verify%20your%20organization%20access.");

  let organizationId: string | undefined = orgs?.[0]?.id;
  if (!organizationId) {
    const slug = "genithm-" + crypto.randomUUID().slice(0, 16);
    const { error: createError } = await supabase.rpc("create_organization", {
      org_name: "My Research Workspace",
      org_slug: slug,
    });
    if (createError) redirect("/dashboard/ai?error=Could%20not%20create%20your%20research%20workspace.");
    const { data: created } = await supabase.from("organizations")
      .select("id").eq("slug", slug).maybeSingle();
    organizationId = created?.id;
  }
  if (!organizationId) redirect("/dashboard/ai?error=Could%20not%20find%20your%20new%20research%20workspace.");

  const { error: projectError } = await supabase.from("projects").insert({
    organization_id: organizationId,
    name: "My Research",
    description: "Private, chat-first scientific research workspace.",
    status: "active",
    created_by: userId,
  });
  if (projectError) redirect("/dashboard/ai?error=Could%20not%20create%20your%20research%20project.");
  revalidatePath("/dashboard/ai");
  redirect("/dashboard/ai");
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

  // Keep approvals and execution progress inside the same chat, not a
  // separate workflow or job detail page.
  revalidatePath(`/dashboard/ai/${conversationId}`);
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

export async function requestAiEvidenceFollowup(formData: FormData) {
  const supabase = await requireUser();
  const interpretationRequestId = String(formData.get("interpretation_request_id") ?? "").trim();
  const conversationId = String(formData.get("conversation_id") ?? "").trim();
  const question = String(formData.get("question") ?? "").trim();

  if (!interpretationRequestId || !conversationId || question.length < 1 || question.length > 4000) {
    redirect(`/dashboard/ai/${conversationId || ""}?error=${encodeURIComponent("Enter an evidence follow-up question between 1 and 4000 characters.")}`);
  }

  const { data, error } = await supabase.rpc("request_ai_evidence_followup", {
    interpretation_request_id: interpretationRequestId,
    question,
  });
  if (error || !data) {
    redirect(`/dashboard/ai/${conversationId}?error=${encodeURIComponent("The evidence follow-up could not be queued. The interpretation may not be completed, project access may have changed, or active request limits may have been reached.")}`);
  }

  revalidatePath(`/dashboard/ai/${conversationId}`);
  redirect(`/dashboard/ai/${conversationId}`);
}
