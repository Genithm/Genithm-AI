import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import {
  currentAiModel,
  generateInstantPlan,
  POLICY_VERSION,
  PROMPT_VERSION,
} from "@/lib/genithm-ai-chat";

type ChatRequest = {
  project_id?: string;
  conversation_id?: string | null;
  user_message?: string;
  attachment_upload_ids?: string[];
};

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (!claimsData?.claims?.sub) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  let body: ChatRequest;
  try {
    body = (await request.json()) as ChatRequest;
  } catch {
    return NextResponse.json({ error: "Invalid chat request." }, { status: 400 });
  }

  const projectId = String(body.project_id ?? "").trim();
  const conversationId = body.conversation_id ? String(body.conversation_id).trim() : null;
  const userMessage = String(body.user_message ?? "").trim();
  const attachmentIds = Array.isArray(body.attachment_upload_ids)
    ? [...new Set(body.attachment_upload_ids.map((value) => String(value).trim()).filter(Boolean))]
    : [];

  if (!projectId || userMessage.length > 8000 || attachmentIds.length > 10 || (!userMessage && attachmentIds.length === 0)) {
    return NextResponse.json(
      { error: "Choose a project and send a message or up to 10 attachments." },
      { status: 422 },
    );
  }

  const { data: prepared, error: prepareError } = await supabase.rpc("request_ai_plan_inline", {
    project_id: projectId,
    conversation_id: conversationId,
    user_message: userMessage,
    attachment_upload_ids: attachmentIds,
  });
  const row = prepared?.[0];

  if (prepareError || !row?.conversation_id || !row?.plan_request_id) {
    return NextResponse.json(
      { error: prepareError?.message || "Could not start the AI response." },
      { status: 400 },
    );
  }

  try {
    const plan = await generateInstantPlan(row.user_message, row.authorized_context);
    const { data: finalStatus, error: finishError } = await supabase.rpc("finish_ai_plan_inline", {
      plan_request_id: row.plan_request_id,
      provider: "deepseek",
      model: currentAiModel(),
      prompt_version: PROMPT_VERSION,
      policy_version: POLICY_VERSION,
      plan,
    });

    if (finishError) throw new Error(finishError.message);

    return NextResponse.json({
      conversation_id: row.conversation_id,
      plan_request_id: row.plan_request_id,
      status: finalStatus,
      message: plan.summary,
      requires_confirmation: plan.intent === "scientific_action",
    });
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "AI response failed.";
    await supabase.rpc("finish_ai_plan_inline_error", {
      plan_request_id: row.plan_request_id,
      processing_error: message,
    });
    return NextResponse.json({ error: message, conversation_id: row.conversation_id }, { status: 502 });
  }
}
