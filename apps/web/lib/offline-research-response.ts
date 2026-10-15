import type { ChatResearchProtocol } from "@/lib/chat-research-protocol";

/**
 * V28: deterministic, non-scientific availability notice.
 * This is persisted as a normal chat reply, never as a research result.
 * Caller must NOT link or enqueue the saved message when returning this reply.
 */
export function offlineResearchReply(protocol: ChatResearchProtocol): string {
  return "Your request for " + protocol.title + " (" + protocol.accession +
    ") was saved, but no scientific work was started or queued. " +
    "The fixed NCBI research service is currently unavailable. " +
    "When it becomes available again, send this request again and explicitly approve the new proposal. " +
    "This is an availability notice, not a scientific result.";
}

export function fixedResearchProposalReply(protocol: ChatResearchProtocol): string {
  return "I can run " + protocol.title + " for " + protocol.accession +
    ". This approved workflow retrieves the NCBI reference, validates the FASTA, and performs the fixed scientific calculation. " +
    "Please review and approve the protocol below your message. No analysis has started.";
}
