"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { parseChatResearchProtocol } from "@/lib/chat-research-protocol";
import { scienceSchemaReady, scienceV22Configured } from "@/lib/science-release";

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
  // Never force the researcher out of chat after approving a scientific action.
  // The same conversation displays execution status and evidence links.
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

/**
 * Human-authorized, chat-bound fixed research pipeline.
 * The browser only supplies IDs. The server re-reads the exact persisted user
 * message and re-derives template/accession before calling the existing
 * actor-bound, quota-aware Supabase RPC. Never execute on AI text alone.
 */
export async function approveChatResearchProtocol(formData: FormData) {
  const supabase = await requireUser();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) redirect("/login");

  const conversationId = String(formData.get("conversation_id") ?? "").trim();
  const messageId = String(formData.get("message_id") ?? "").trim();
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
  if (!uuid.test(conversationId) || !uuid.test(messageId)) {
    redirect("/dashboard/ai?error=Invalid%20research%20approval%20request");
  }

  const { data: conversation } = await supabase.from("ai_conversations")
    .select("id,project_id,created_by,status").eq("id", conversationId)
    .eq("created_by", userId).eq("status", "active").maybeSingle();
  if (!conversation) {
    redirect("/dashboard/ai?error=Conversation%20not%20accessible");
  }

  // Do not touch new columns or approval RPCs until the schema is deployed.
  // A forged approval form cannot switch on the feature for this account.
  const { error: schemaError } = scienceV22Configured()
    ? await supabase.from("ai_messages")
        .select("id,protocol_input_scope,research_pipeline_run_id").limit(0)
    : { error: null };
  if (!scienceSchemaReady(scienceV22Configured(), schemaError)) {
    redirect(`/dashboard/ai/${conversationId}?error=${encodeURIComponent(
      "Scientific protocol approval is not enabled on this database yet. Ordinary chat remains available.",
    )}`);
  }

  const { data: source } = await supabase.from("ai_messages")
    .select("id,role,content,conversation_id,conversation_owner_id,attachment_upload_ids,protocol_input_scope,research_pipeline_run_id")
    .eq("id", messageId).eq("conversation_id", conversationId)
    .eq("conversation_owner_id", userId).eq("role", "user").maybeSingle();
  // Never dispatch a reference-only NCBI protocol for an original message
  // carrying user sequence files. Consent must refer to the exact same inputs.
  const protocol = source && source.protocol_input_scope === "text_only" &&
    Array.isArray(source.attachment_upload_ids) && source.attachment_upload_ids.length === 0
    ? parseChatResearchProtocol(source.content) : null;
  if (!protocol) {
    redirect(`/dashboard/ai/${conversationId}?error=${encodeURIComponent("No eligible fixed research protocol was found in the original chat message.")}`);
  }

  // Atomic database operation: re-parse the stored message and bind the
  // authoritative pipeline run to that message under the current user session.
  // Browser supplies only the message locator, never accession or template.
  const { data: runId, error } = await supabase.rpc("approve_chat_research_pipeline", {
    message_id: messageId,
  });

  if (error || !runId || !uuid.test(runId)) {
    redirect(`/dashboard/ai/${conversationId}?error=${encodeURIComponent(
      "Research could not start or be linked to this message. The V22 database migration may not be installed, project access may have changed, or capacity limits may have been reached.",
    )}`);
  }

  revalidatePath(`/dashboard/ai/${conversationId}`);
  redirect(`/dashboard/ai/${conversationId}?pipeline_id=${runId}`);
}
