import { parseChatResearchProtocol } from "./chat-research-protocol.ts";

export type RecoverableMessage = {
  role: string;
  content: string;
  protocol_input_scope: string | null;
  research_pipeline_run_id: string | null;
  attachment_upload_ids: readonly string[] | null;
  plan_request_id: string | null;
};

/**
 * Find a bounded, already user-owned conversation's latest *unattested*
 * direct NCBI request. It is only a suggestion to COMPOSE a new message.
 *
 * Never upgrade an old message's protocol_input_scope after the fact:
 * browser media from the original turn may not be represented by the
 * stored attachment list. The new message must be sealed afresh.
 */
export function latestRecoverableResearchRequest<T extends RecoverableMessage>(
  chronologicalMessages: readonly T[],
): T | null {
  for (let i = chronologicalMessages.length - 1; i >= 0; i--) {
    const message = chronologicalMessages[i];
    if (message.role !== "user" ||
        message.protocol_input_scope !== null ||
        message.research_pipeline_run_id !== null ||
        message.plan_request_id !== null ||
        (message.attachment_upload_ids?.length ?? 0) > 0) continue;
    if (parseChatResearchProtocol(message.content)) return message;
  }
  return null;
}
