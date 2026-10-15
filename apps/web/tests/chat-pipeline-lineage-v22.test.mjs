import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseChatResearchProtocol } from "../lib/chat-research-protocol.ts";

const read = (relativePath) => readFileSync(new URL(relativePath, import.meta.url), "utf8");

const migration = read("../../../supabase/migrations/20261015174500_ai_chat_pipeline_lineage_v1.sql");
const actions = read("../app/dashboard/ai/actions.ts");
const api = read("../app/api/ai/chat/route.ts");
const page = read("../app/dashboard/ai/[id]/page.tsx");
const types = read("../lib/ai-database.types.ts");

test("V22 migration seals fixed protocol consent to the original user message", () => {
  assert.match(migration, /add column protocol_input_scope text/);
  assert.match(migration, /add column research_pipeline_run_id uuid/);
  assert.match(migration, /add constraint ai_messages_scoped_research_run_fk/);
  assert.match(migration, /references public\.research_pipeline_runs\(id,project_id,organization_id,requested_by\)/);
  assert.match(migration, /add constraint ai_messages_authorized_research_link_ck/);
  assert.match(migration, /source\.protocol_input_scope is distinct from 'text_only'/);
  assert.match(migration, /cardinality\(source\.attachment_upload_ids\)<>0/);
  assert.match(migration, /source\.plan_request_id is not null/);
  assert.match(migration, /conversation_owner_id=actor/);
  assert.match(migration, /created_by=actor and status='active'/);
  assert.match(migration, /app_private\.is_org_member\(source\.organization_id\)/);
  assert.match(migration, /for update/);
  assert.match(migration, /public\.request_research_nucleotide_pipeline\(source\.project_id,protocol\.accession\)/);
  assert.match(migration, /public\.request_research_protein_pipeline\(source\.project_id,protocol\.accession\)/);
  assert.match(migration, /research_pipeline_run_id=run\.id/);
  assert.doesNotMatch(migration, /grant\s+update\s+on\s+public\.ai_messages\s+to\s+authenticated/i);
});
test("V22 approval accepts a message locator only; SQL chooses accession and template", () => {
  assert.match(migration, /approve_chat_research_pipeline\(p_message_id uuid\)/);
  assert.match(migration, /parse_fixed_chat_protocol\(source\.content\)/);
  assert.match(migration, /grant execute on function public\.approve_chat_research_pipeline\(uuid\)\s+to authenticated/i);
  assert.match(actions, /supabase\.rpc\("approve_chat_research_pipeline", \{\s+message_id: messageId/);
  assert.match(actions, /source\.protocol_input_scope === "text_only"/);
  assert.doesNotMatch(actions, /formData\.get\("accession"\)/);
  assert.doesNotMatch(actions, /formData\.get\("template"\)/);
});
test("V22 input attestation never trusts historical messages or unpersisted images", () => {
  assert.match(migration, /protocol_input_scope is not null then/);
  assert.match(migration, /grant execute on function public\.mark_chat_protocol_input_scope\(uuid,uuid,boolean\)\s+to service_role/i);
  assert.doesNotMatch(migration, /grant execute on function public\.mark_chat_protocol_input_scope\(uuid,uuid,boolean\)\s+to authenticated/i);
  assert.match(api, /service\.rpc\("mark_chat_protocol_input_scope"/);
  assert.match(api, /has_media: mediaAttachments\.length > 0/);
  assert.match(api, /if \(inputScopeError\) throw/);
  assert.match(page, /message\.protocol_input_scope === "text_only"/);
});
test("V22 conversation can rehydrate only owner/project-scoped linked pipelines", () => {
  assert.match(page, /message\.research_pipeline_run_id/);
  assert.match(page, /linkedPipelineIds/);
  assert.match(page, /\.eq\("project_id", conversation\.project_id\)/);
  assert.match(page, /\.eq\("requested_by", claimsData\.claims\.sub\)/);
  // V24 additionally verifies message lineage for archive entries outside the
  // most recent chat window, instead of treating a URL locator as authority.
  assert.match(page, /linkedPipelineById\.has\(candidatePipelineId\) \|\| historicalMessageLink\?\.id/);
  assert.match(page, /\.eq\("conversation_owner_id", claimsData\.claims\.sub\)/);
  assert.match(page, /\.eq\("research_pipeline_run_id", candidatePipelineId\)/);
  assert.match(page, /View approved research/);
  assert.match(page, /!message\.research_pipeline_run_id/);
  assert.match(types, /protocol_input_scope: "text_only" \| "with_attachments" \| null/);
  assert.match(types, /research_pipeline_run_id: string \| null/);
  assert.match(types, /approve_chat_research_pipeline:/);
});
test("V22 latest-message window preserves the most recent approved scientific runs", () => {
  assert.match(page, /\.order\("created_at", \{ ascending: false \}\)/);
  assert.match(page, /\.order\("id", \{ ascending: false \}\)/);
  assert.match(page, /const chronologicalMessages = \[\.\.\.\(messages \?\? \[\]\)\]\.reverse\(\)/);
  assert.match(page, /linkedPipelineIds = \[\.\.\.new Set\(chronologicalMessages/);
  assert.match(page, /\{chronologicalMessages\.map\(\(message\)/);
});

test("V22 classifier remains conservative for explicitly unsupported research", () => {
  assert.equal(parseChatResearchProtocol("Explain an ORF scan of NM_000546.6"), null);
  assert.equal(parseChatResearchProtocol("Run ORF for NM_000546.6 and NP_000537.3"), null);
  assert.equal(parseChatResearchProtocol("Run ORF for NM_000546.6\nwith FASTA attached"), null);
  assert.equal(parseChatResearchProtocol("Please retrieve NM_000546.6 and run ORF scan")?.template, "ncbi_nucleotide_orf_v1");
});
