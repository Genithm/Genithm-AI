import type { Json } from "@/lib/ai-database.types";
import { validateChatFileEvidence, safeChatFileContext } from "@/lib/chat-file-intake";
import { isGwasExecutionRequest, gwasInputGuidance } from "@/lib/gwas-chat-intent";
import { shouldRunPublicAirway, scienceCompletionText } from "@/lib/chat-science-intent";
import { isPublicRiceGwasRequest, riceGwasCompletionMessage } from "@/lib/public-rice-gwas-intent";
import { matchLocalAnalysisRequest, localAnalysisGuidance } from "@/lib/local-analysis-intent";
import { buildAuthorizedResearchContext } from "@/lib/authorized-research-context";
import {assertMatchingEvidence, loadVerifiedResearchFiles, withVerifiedVcfSiteEvidence} from "@/lib/verified-research-files";
import {isVerifiedVcfComparisonRequest, renderVerifiedVcfComparison} from "@/lib/verified-vcf-comparison";
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
  local_file_evidence?: unknown;
  completed_science_run_id?: string;
  share_local_text_excerpts?: boolean;
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
  const completedScienceRunId = String(body.completed_science_run_id ?? "").trim();
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

  // User-browser summaries are NOT verified storage objects or authorized
  // scientific inputs. Reject oversized/forged fields before any database RPC.
  let localFiles;
  try {
    localFiles = validateChatFileEvidence(body.local_file_evidence);
    if (body.share_local_text_excerpts !== undefined && typeof body.share_local_text_excerpts !== "boolean")
      throw new Error("Invalid text sharing consent.");
    if (!body.share_local_text_excerpts && localFiles.some(file => file.excerpt !== undefined))
      throw new Error("A text excerpt was provided without permission.");
  } catch {
    return Response.json({ error: "Local research-file evidence is invalid or exceeds safe limits." }, { status: 422 });
  }

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
    (completedScienceRunId.length > 0 && (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(completedScienceRunId) ||
      attachmentIds.length > 0 || researchFileIds.length > 0 || mediaAttachments.length > 0 || localFiles.length > 0)) ||
    attachmentIds.length > 10 ||
    fileIdsInvalid ||
    (researchFileIds.length > 0 && !userMessage) ||
    mediaAttachments.length > 4 ||
    mediaInvalid ||
    totalMediaLength > 44_000_000 ||
    (!userMessage && attachmentIds.length === 0 && mediaAttachments.length === 0 && localFiles.length === 0) ||
    (localFiles.length > 0 && userMessage.length > 7500)
  ) {
    return Response.json(
      { error: "Choose a project and send a message or supported research attachments (or shorten the prompt)." },
      { status: 422 },
    );
  }

  // The requested calculation has already executed in an isolated worker.
  // Before persisting any claim or emitting an artifact link, verify the run
  // is owned by this authenticated researcher AND bound to this project.
  let completedScience: Awaited<ReturnType<typeof import("@/lib/chat-science-runner").getChatScienceRun>> | null = null;
  if (completedScienceRunId) {
    try {
      const { getChatScienceRun } = await import("@/lib/chat-science-runner");
      completedScience = await getChatScienceRun(userId, projectId, completedScienceRunId);
    } catch {
      return Response.json({ error: "The scientific run is expired, unverified, or not owned by this project." }, { status: 409 });
    }
  }

  const localFilenames = localFiles.map(file => `${file.filename} (${file.format}, ${file.inspection})`).join(", ");
  // Persist only filenames and the local-only disclosure in the normal user
  // message. Raw file contents and browser-computed metrics remain ephemeral;
  // reloads must never pretend the original source is still available.
  const attachmentLabel = localFiles.length
    ? `\n[Browser-only research attachments: ${localFilenames.slice(0, 360)}; originals not stored with this conversation.]`
    : "";
  const recordedUserMessage = userMessage
    ? userMessage + attachmentLabel + (completedScience ? `\n[Genithm scientific computation completed for ${completedScience.kind}; original uploaded inputs removed after analysis.]` : "")
    : localFiles.length
      ? `Please review the locally inspected research files: ${localFilenames.slice(0, 360)}. Only bounded browser-derived evidence is available; original files were not uploaded.`
      : mediaAttachments.length
        ? `Attached image${mediaAttachments.length === 1 ? "" : "s"}: ${mediaAttachments.map((attachment) => attachment.filename).join(", ")}`
        : "";

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
        p_project_id: projectId, p_conversation_id: conversationId,
        p_user_message: recordedUserMessage, p_attachment_upload_ids: attachmentIds,
        p_research_file_ids: researchFileIds,
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

          // V58: trust neither a claimed run ID nor LLM prose. The run was
          // checksum-verified and scoped to this user/project before the chat
          // turn was recorded. Persist only authoritative scientific output.
          if (completedScience && completedScienceRunId) {
            const reply = scienceCompletionText(completedScienceRunId, completedScience.summary);
            const { error: finishError } = await service.rpc("finish_ai_chat_turn", {
              user_message_id: row.user_message_id, expected_user_id: userId,
              assistant_message: reply,
            });
            if (finishError) throw new Error("Could not record the verified scientific result.");
            controller.enqueue(sse("done", { conversation_id: row.conversation_id,
              status: "science_completed", message: reply, requires_confirmation: false }));
            return;
          }

          // V58: when no research files are attached, a legitimate published
          // human airway study may be selected and executed automatically.
          // Never replace a user's requested different organism, single-cell
          // study or FASTQ quantification with this convenient public example.
          const historicalContext = row.authorized_context &&
            typeof row.authorized_context === "object" && !Array.isArray(row.authorized_context)
            ? row.authorized_context as Record<string, unknown> : null;
          const hasResearchInputs = attachmentIds.length > 0 || researchFileIds.length > 0 ||
            mediaAttachments.length > 0 || localFiles.length > 0;
          if (!hasResearchInputs && shouldRunPublicAirway(row.user_message,
              historicalContext?.conversation_history)) {
            try {
              const { runChatScience } = await import("@/lib/chat-science-runner");
              const study = await runChatScience(userId, projectId, "public-airway", {}, request.signal,
                text => controller.enqueue(sse("progress", { text })));
              const reply = scienceCompletionText(study.runId, study.summary);
              const { error: finishError } = await service.rpc("finish_ai_chat_turn", {
                user_message_id: row.user_message_id, expected_user_id: userId,
                assistant_message: reply,
              });
              if (finishError) throw new Error("RNA study completed but its chat result could not be recorded.");
              controller.enqueue(sse("done", { conversation_id: row.conversation_id,
                status: "science_completed", message: reply, requires_confirmation: false }));
            } catch (cause) {
              if (request.signal.aborted) throw cause;
              const detail = cause instanceof Error ? cause.message.slice(0, 240) : "the scientific worker did not finish";
              const reply = "I selected the published human airway RNA-seq dataset to answer your research request, but " +
                detail + ". No analysis or result files were claimed as successful. " +
                "The research goal remains an RNA expression comparison; you may also attach a raw count matrix and design sheet.";
              const { error: finishError } = await service.rpc("finish_ai_chat_turn", {
                user_message_id: row.user_message_id, expected_user_id: userId,
                assistant_message: reply,
              });
              if (finishError) throw new Error("Could not record the RNA scientific failure.");
              controller.enqueue(sse("done", { conversation_id: row.conversation_id,
                status: "science_failed", message: reply, requires_confirmation: false }));
            }
            return;
          }

          // V57: a real published-data rice GWAS can be executed and exported
          // directly from a signed-in chat request. Follow-ups within this
          // conversation inherit only its explicit rice GWAS goal. Unlike the
          // manual V54 lab, this job fetches public genotype + phenotype data.
          const contextForRice = row.authorized_context && typeof row.authorized_context === "object" &&
            !Array.isArray(row.authorized_context)
            ? row.authorized_context as Record<string, unknown> : null;
          const hasUserSources = attachmentIds.length > 0 || mediaAttachments.length > 0 ||
            researchFileIds.length > 0 || localFiles.length > 0;
          if (!hasUserSources && isPublicRiceGwasRequest(row.user_message, contextForRice?.conversation_history)) {
            try {
              const { executePublicRiceGwas } = await import("@/lib/public-rice-gwas-runner");
              const study = await executePublicRiceGwas(userId, request.signal,
                (text) => controller.enqueue(sse("progress", { text })));
              const reply = riceGwasCompletionMessage(study.runId, study.summary);
              const { error: finishError } = await service.rpc("finish_ai_chat_turn", {
                user_message_id: row.user_message_id,
                expected_user_id: userId,
                assistant_message: reply,
              });
              if (finishError) throw new Error("Rice GWAS completed, but its chat result could not be recorded.");
              controller.enqueue(sse("done", {
                conversation_id: row.conversation_id,
                status: "public_rice_gwas_completed",
                message: reply,
                requires_confirmation: false,
              }));
            } catch (failure) {
              if (request.signal.aborted) throw failure;
              const reason = failure instanceof Error ? failure.message.slice(0, 260) : "The public dataset worker could not finish.";
              const reply = "I selected the published Rice Diversity Panel and attempted the requested GWAS, but " +
                reason + " No study results were certified or invented. The research goal is still rice GWAS.";
              const { error: finishError } = await service.rpc("finish_ai_chat_turn", {
                user_message_id: row.user_message_id,
                expected_user_id: userId,
                assistant_message: reply,
              });
              if (finishError) throw new Error("Could not record the public rice GWAS failure.");
              controller.enqueue(sse("done", {
                conversation_id: row.conversation_id,
                status: "public_rice_gwas_failed",
                message: reply,
                requires_confirmation: false,
              }));
            }
            return;
          }

          // GWAS has a real authenticated browser-local execution path. Neither
          // the LLM's eight server-side proposal types nor the science-worker
          // fleet can run a GWAS from a chat text turn. Never fabricate a run.
          if (isGwasExecutionRequest(row.user_message)) {
            const reply = gwasInputGuidance();
            const { error: finishError } = await service.rpc("finish_ai_chat_turn", {
              user_message_id: row.user_message_id,
              expected_user_id: userId,
              assistant_message: reply,
            });
            if (finishError) throw new Error(finishError.message);
            controller.enqueue(sse("done", {
              conversation_id: row.conversation_id,
              status: "gwas_inputs_required",
              message: reply,
              requires_confirmation: false,
            }));
            return;
          }

          // V56: these are real bounded local labs, not server-side scientific
          // action types. Record input guidance without sending any local file
          // bodies to the LLM or claiming execution/approval has occurred.
          const localLab = matchLocalAnalysisRequest(row.user_message);
          if (localLab) {
            const reply = localAnalysisGuidance(localLab);
            const { error: finishError } = await service.rpc("finish_ai_chat_turn", {
              user_message_id: row.user_message_id,
              expected_user_id: userId,
              assistant_message: reply,
            });
            if (finishError) throw new Error(finishError.message);
            controller.enqueue(sse("done", {
              conversation_id: row.conversation_id,
              status: localLab === "expression" ? "expression_inputs_required" : "pathway_inputs_required",
              message: reply,
              requires_confirmation: false,
            }));
            return;
          }

          // Explicit NCBI execution requests must never be answered by the
          // conversational model when scientific execution is unavailable.
          // Persist a truthful availability notice against the saved user
          // message. No attestation, queue, run, or approval is created.
          const requestedFixedProtocol = researchFileIds.length === 0 && localFiles.length === 0 &&
            attachmentIds.length === 0 && mediaAttachments.length === 0
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

          const context = buildAuthorizedResearchContext(row.authorized_context);
          // V65: the DB first bound immutable source/report hashes to this turn.
          // Add only worker-verified, numeric site QC to conversational context.
          // Never use local browser claims or unscoped file bytes here.
          const scopedContext = withVerifiedVcfSiteEvidence(context,verifiedFiles);
          // V66: comparisons of already-authorized VCF site reports are exact,
          // deterministic and do not involve an LLM, raw VCF or new compute.
          // Mixed image/local/sequence attachments stay on the normal chat path.
          if (!attachmentIds.length && !localFiles.length && !mediaAttachments.length &&
              isVerifiedVcfComparisonRequest(row.user_message,verifiedFiles)) {
            const reply=renderVerifiedVcfComparison(row.user_message,verifiedFiles);
            const {error: finishError}=await service.rpc("finish_ai_chat_turn", {
              user_message_id:row.user_message_id, expected_user_id:userId,
              assistant_message:reply,
            });
            if(finishError)throw new Error("Could not save the verified VCF comparison.");
            controller.enqueue(sse("done", {
              conversation_id:row.conversation_id,status:"verified_vcf_comparison",
              message:reply,requires_confirmation:false,
            }));
            return;
          }
          const conversationalContext = localFiles.length ? {
            ...scopedContext,
            // A client can forge any of these counts. Keep the trust boundary
            // distinct from database-authenticated project files and job IDs.
            client_reported_local_file_previews: safeChatFileContext(localFiles, body.share_local_text_excerpts === true),
          } : scopedContext;
          const providerResult = await startStreamingChat(
            row.user_message,
            conversationalContext,
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

          try {
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
                const remaining = 16000 - partialVisible.length;
                if (delta.content.length > remaining) throw new Error("AI response exceeded safe response length.");
                const piece = delta.content;
                partialVisible += piece;
                if (!researchFileIds.length) controller.enqueue(sse("delta", { text: piece }));
              }
            }
          }

          } finally {
            await reader.cancel().catch(() => undefined);
          }
          if (!providerDone) throw new Error("AI provider did not finish the response.");
          console.info(JSON.stringify({ event: "ai_stream_completed", provider: providerResult.provider, configured_model: providerResult.configuredModel, returned_model: providerResult.model, first_output_ms: providerResult.firstOutputMs, fallback_used: providerResult.fallbackUsed }));

          // Evidence turns cannot invent executable use of a stored raw file.
          // Require a complete provider stream before showing/persisting its reply.
          if (researchFileIds.length && (!providerDone || toolSeen || !partialVisible.trim())) {
            throw new Error("AI did not finish a non-executable research-file evidence response.");
          }
          if (toolSeen) {
            if (localFiles.length) throw new Error("Local file previews cannot authorize server-side scientific operations.");
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
            const stoppedPlan = conversationalPlan("Generation stopped before completion. No complete AI answer was saved.");
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
