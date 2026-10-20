import type { Json } from "@/lib/ai-database.types";
import { buildAuthorizedResearchContext } from "@/lib/authorized-research-context";
import {assertMatchingEvidence, loadVerifiedResearchFiles} from "@/lib/verified-research-files";
import { parseChatResearchProtocol } from "@/lib/chat-research-protocol";
import { fixedResearchProposalReply, offlineResearchReply } from "@/lib/offline-research-response";
import { scienceSchemaUnavailableError, scienceV22Configured } from "@/lib/science-release";
import { scienceExecutionReady } from "@/lib/science-execution-readiness";
import {
  conversationalPlan,
  POLICY_VERSION,
  PROMPT_VERSION,
  scientificPlanFromToolArguments,
  normalizeScientificPlanForExecution,
  startStreamingChat,
} from "@/lib/genithm-ai-chat";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

type ChatRequest = {
  project_id?: string;
  conversation_id?: string | null;
  user_message?: string;
  attachment_upload_ids?: string[];
  research_file_ids?: string[];
  media_attachments?: Array<{ filename?: string; mime_type?: string; data_url?: string }>;
};

type ProviderChunk = {
  choices?: Array<{
    delta?: {
      content?: string | null;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        type?: string;
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
  }>;
};

const encoder = new TextEncoder();

function sse(event: string, payload: unknown) {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) {
    return Response.json({ error: "Authentication required." }, { status: 401 });
  }

  let body: ChatRequest;
  try {
    body = (await request.json()) as ChatRequest;
  } catch {
    return Response.json({ error: "Invalid chat request." }, { status: 400 });
  }

  const projectId = String(body.project_id ?? "").trim();
  const conversationId = body.conversation_id ? String(body.conversation_id).trim() : null;
  const userMessage = String(body.user_message ?? "").trim();
  const attachmentIds = Array.isArray(body.attachment_upload_ids)
    ? [...new Set(body.attachment_upload_ids.map((value) => String(value).trim()).filter(Boolean))]
    : [];
  const researchFileIds = Array.isArray(body.research_file_ids)
    ? body.research_file_ids.map(value => String(value).trim()) : [];
  const fileIdsInvalid = body.research_file_ids !== undefined &&
    (!Array.isArray(body.research_file_ids) ||
      body.research_file_ids.some(value => typeof value !== "string") ||
      researchFileIds.length > 4 || new Set(researchFileIds).size !== researchFileIds.length ||
      researchFileIds.some(value => !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value)));
  const mediaAttachments = Array.isArray(body.media_attachments)
    ? body.media_attachments.map((attachment) => ({
        filename: String(attachment.filename ?? "").trim().slice(0, 255),
        mime_type: String(attachment.mime_type ?? "").trim().toLowerCase(),
        data_url: String(attachment.data_url ?? "").trim(),
      }))
    : [];

  const allowedImageTypes = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
  const mediaInvalid = mediaAttachments.some((attachment) => {
    if (!attachment.filename || !allowedImageTypes.has(attachment.mime_type)) return true;
    const prefix = `data:${attachment.mime_type};base64,`;
    return !attachment.data_url.startsWith(prefix) || attachment.data_url.length > 12_000_000;
  });
  const totalMediaLength = mediaAttachments.reduce((sum, attachment) => sum + attachment.data_url.length, 0);

  if (
    !projectId ||
    userMessage.length > 8000 ||
    attachmentIds.length > 10 ||
    fileIdsInvalid ||
    (researchFileIds.length > 0 && !userMessage) ||
    mediaAttachments.length > 4 ||
    mediaInvalid ||
    totalMediaLength > 44_000_000 ||
    (!userMessage && attachmentIds.length === 0 && mediaAttachments.length === 0)
  ) {
    return Response.json(
      { error: "Choose a project and send a message, sequence files, or up to 4 supported images." },
      { status: 422 },
    );
  }

  const recordedUserMessage = userMessage || (
    mediaAttachments.length
      ? `Attached image${mediaAttachments.length === 1 ? "" : "s"}: ${mediaAttachments.map((attachment) => attachment.filename).join(", ")}`
      : ""
  );

  // File IDs alone are never sufficient: fetch the authenticated, checksummed
  // full report through Genithm's verifier API before starting a chat turn.
  // A stale/foreign/unverified source fails closed with no model call.
  let verifiedFiles;
  try {
    const token = researchFileIds.length ? (await supabase.auth.getSession()).data.session?.access_token || "" : "";
    verifiedFiles = await loadVerifiedResearchFiles(researchFileIds, projectId, token, request.signal);
  } catch {
    return Response.json({ error: "Selected research file is inaccessible or not fully verified." }, { status: 409 });
  }

  // Migration-aware: ordinary V47 chat continues to work during database rollout.
  const { data: prepared, error: prepareError } = researchFileIds.length
    ? await supabase.rpc("request_ai_chat_turn_with_files_v48", {
        project_id: projectId, conversation_id: conversationId,
        user_message: recordedUserMessage, attachment_upload_ids: attachmentIds,
        research_file_ids: researchFileIds,
      })
    : await supabase.rpc("request_ai_chat_turn", {
        project_id: projectId, conversation_id: conversationId,
        user_message: recordedUserMessage, attachment_upload_ids: attachmentIds,
      });
  const row = prepared?.[0];

  if (prepareError || !row?.conversation_id || !row?.user_message_id) {
    return Response.json(
      { error: prepareError?.message || "Could not start the AI response." },
      { status: 400 },
    );
  }

  try {
    const context = prepared?.[0]?.authorized_context;
    if (!context || typeof context !== "object" || Array.isArray(context)) throw new Error("Missing authorized context.");
    if (researchFileIds.length) assertMatchingEvidence((context as Record<string,unknown>).selected_verified_research_files, verifiedFiles);
  } catch {
    return Response.json({ error: "Verified file evidence was not recorded consistently. No AI request was sent." }, { status: 409 });
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      void (async () => {
        const service = createServiceClient();
        let partialVisible = "";
        try {
          // V26 migration-aware rollout. Normal chat must remain usable if
          // web code arrives before V22 columns/functions are installed.
          // The explicit opt-in is server-side and defaults to disabled.
          let offerFixedResearch = false;
          if (scienceV22Configured()) {
            const { error: schemaError } = await supabase.from("ai_messages")
              .select("id,protocol_input_scope,research_pipeline_run_id").limit(0);
            if (!schemaError && await scienceExecutionReady(service)) {
              const { error: inputScopeError } = await service.rpc("mark_chat_protocol_input_scope", {
                user_message_id: row.user_message_id,
                expected_user_id: userId,
                has_media: mediaAttachments.length > 0,
              });
              if (inputScopeError && !scienceSchemaUnavailableError(inputScopeError)) {
                throw new Error("Could not seal chat input scope for research consent.");
              }
              offerFixedResearch = !inputScopeError;
            }
          }
          controller.enqueue(sse("meta", {
            conversation_id: row.conversation_id,
            user_message_id: row.user_message_id,
          }));

          // Explicit NCBI execution requests must never be answered by the
          // conversational model when scientific execution is unavailable.
          // Persist a truthful availability notice against the saved user
          // message. No attestation, queue, run, or approval is created.
          const requestedFixedProtocol = attachmentIds.length === 0 &&
            mediaAttachments.length === 0
              ? parseChatResearchProtocol(row.user_message) : null;
          if (requestedFixedProtocol && !offerFixedResearch) {
            const reply = offlineResearchReply(requestedFixedProtocol);
            const { error: finishError } = await service.rpc("finish_ai_chat_turn", {
              user_message_id: row.user_message_id,
              expected_user_id: userId,
              assistant_message: reply,
            });
            if (finishError) throw new Error(finishError.message);
            controller.enqueue(sse("done", {
              conversation_id: row.conversation_id,
              status: "research_unavailable",
              message: reply,
              requires_confirmation: false,
            }));
            return;
          }

          // A fixed protocol with an explicit accession can be proposed
          // deterministically. No provider tool-call, cost-bearing science,
          // queue or worker dispatch occurs until the human clicks Approve.
          // Attachments take the normal model pathway: the fixed NCBI
          // protocol must never silently ignore user-supplied files.
          const fixedProtocol = offerFixedResearch ? requestedFixedProtocol : null;
          if (fixedProtocol) {
            const reply = fixedResearchProposalReply(fixedProtocol);
            const { error: finishError } = await service.rpc("finish_ai_chat_turn", {
              user_message_id: row.user_message_id,
              expected_user_id: userId,
              assistant_message: reply,
            });
            if (finishError) throw new Error(finishError.message);
            controller.enqueue(sse("done", {
              conversation_id: row.conversation_id,
              status: "protocol_ready",
              message: reply,
              requires_confirmation: true,
            }));
            return;
          }

          const providerResult = await startStreamingChat(
            row.user_message,
            buildAuthorizedResearchContext(row.authorized_context),
            mediaAttachments,
            request.signal,
          );
          const reader = providerResult.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          let toolArguments = "";
          let toolName = "";
          let toolSeen = false;
          let providerDone = false;

          while (!providerDone) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            if (buffer.length > 65536) throw new Error("AI provider stream exceeded the permitted chunk size.");

            let separator = buffer.indexOf("\n");
            while (separator >= 0) {
              const rawLine = buffer.slice(0, separator).trimEnd();
              buffer = buffer.slice(separator + 1);
              separator = buffer.indexOf("\n");

              if (!rawLine.startsWith("data:")) continue;
              const data = rawLine.slice(5).trim();
              if (!data) continue;
              if (data === "[DONE]") {
                providerDone = true;
                break;
              }

              let parsed: ProviderChunk;
              try {
                parsed = JSON.parse(data) as ProviderChunk;
              } catch {
                continue;
              }

              const delta = parsed.choices?.[0]?.delta;
              if (!delta) continue;

              if (delta.tool_calls?.length) {
                toolSeen = true;
                for (const call of delta.tool_calls) {
                  if (call.function?.name) toolName = call.function.name;
                  if (call.function?.arguments) toolArguments += call.function.arguments;
                if (toolArguments.length > 30000) throw new Error("Scientific tool arguments too large.");
                }
              }

              if (!toolSeen && typeof delta.content === "string" && delta.content) {
                const remaining = 2000 - partialVisible.length;
                if (researchFileIds.length && delta.content.length > remaining) throw new Error("AI response exceeded safe evidence response length.");
                if (remaining <= 0) {
                  await reader.cancel();
                  providerDone = true;
                  break;
                }
                const piece = delta.content.slice(0, remaining);
                partialVisible += piece;
                if (!researchFileIds.length) controller.enqueue(sse("delta", { text: piece }));
              }
            }
          }

          // Evidence turns cannot invent executable use of a stored raw file.
          // Require a complete provider stream before showing/persisting its reply.
          if (researchFileIds.length && (!providerDone || toolSeen || !partialVisible.trim())) {
            throw new Error("AI did not finish a non-executable research-file evidence response.");
          }
          if (toolSeen) {
            if (toolName !== "propose_scientific_action") {
              throw new Error("AI provider returned an unsupported tool call.");
            }
            const rawPlan = scientificPlanFromToolArguments(toolArguments);
            const plan = await normalizeScientificPlanForExecution(rawPlan, row.user_message);
            if (plan.intent !== "scientific_action" || !plan.action) {
              const { error: finishError } = await service.rpc("finish_ai_chat_turn", {
                user_message_id: row.user_message_id,
                expected_user_id: userId,
                assistant_message: plan.summary,
              });
              if (finishError) throw new Error(finishError.message);
              controller.enqueue(sse("done", {
                conversation_id: row.conversation_id,
                status: "conversation",
                message: plan.summary,
                requires_confirmation: false,
              }));
              return;
            }
            const { data: planRows, error: planError } = await service.rpc("create_ai_plan_from_chat", {
              user_message_id: row.user_message_id,
              expected_user_id: userId,
              provider: providerResult.provider,
              model: providerResult.model,
              prompt_version: PROMPT_VERSION,
              policy_version: POLICY_VERSION,
              plan: plan as unknown as Json,
            });
            const createdPlan = planRows?.[0];
            if (planError || !createdPlan?.plan_request_id) {
              throw new Error(planError?.message || "Could not create the scientific plan.");
            }
            // Planning is not user authorization. Persist a constrained ready
            // plan; the project owner must approve via approve_ai_plan, which
            // atomically revalidates permissions, resources and compute quotas.
            controller.enqueue(sse("done", {
              conversation_id: row.conversation_id,
              plan_request_id: createdPlan.plan_request_id,
              status: "awaiting_approval",
              message: plan.summary,
              requires_confirmation: true,
            }));
          } else {
            const plan = conversationalPlan(partialVisible);
            const { error: finishError } = await service.rpc("finish_ai_chat_turn", {
              user_message_id: row.user_message_id,
              expected_user_id: userId,
              assistant_message: plan.summary,
            });
            if (finishError) throw new Error(finishError.message);
            if (researchFileIds.length) controller.enqueue(sse("delta", { text: plan.summary }));
            controller.enqueue(sse("done", {
              conversation_id: row.conversation_id,
              status: "conversation",
              message: plan.summary,
              requires_confirmation: false,
            }));
          }
        } catch (caught) {
          const stopped = request.signal.aborted || (caught instanceof Error && caught.name === "AbortError");
          if (stopped) {
            const stoppedPlan = conversationalPlan(partialVisible || "Generation stopped.");
            await service.rpc("finish_ai_chat_turn", {
              user_message_id: row.user_message_id,
              expected_user_id: userId,
              assistant_message: stoppedPlan.summary,
            });
          } else {
            const message = caught instanceof Error ? caught.message : "AI response failed.";
            await service.rpc("finish_ai_chat_turn", {
              user_message_id: row.user_message_id,
              expected_user_id: userId,
              assistant_message: "I could not complete that response. Please try again.",
            });
            controller.enqueue(sse("error", {
              conversation_id: row.conversation_id,
              error: message,
            }));
          }
        } finally {
          if (!request.signal.aborted) controller.close();
        }
      })();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
