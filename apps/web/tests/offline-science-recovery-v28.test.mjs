import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseChatResearchProtocol } from "../lib/chat-research-protocol.ts";
import {
  offlineResearchReply, fixedResearchProposalReply,
} from "../lib/offline-research-response.ts";
import { latestRecoverableResearchRequest } from "../lib/recoverable-research-request.ts";

const file = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const route = file("../app/api/ai/chat/route.ts");
const page = file("../app/dashboard/ai/[id]/page.tsx");
const refresh = file("../components/research-availability-refresh.tsx");
const composer = file("../components/ai-chat-composer.tsx");

const base = {
  role: "user", content: "Run ORF scan on NM_000546.6",
  protocol_input_scope: null, research_pipeline_run_id: null,
  attachment_upload_ids: [], plan_request_id: null,
};

test("V28 unavailable explicit NCBI request receives truthful, deterministic non-result", () => {
  for (const request of [
    "Run ORF scan on NM_000546.6",
    "Calculate protein properties for NP_000537.3",
  ]) {
    const protocol = parseChatResearchProtocol(request);
    assert.ok(protocol);
    const response = offlineResearchReply(protocol);
    assert.match(response, new RegExp(protocol.accession.replace(".", "\\.")));
    assert.match(response, /no scientific work was started or queued/);
    assert.match(response, /send this request again and explicitly approve/);
    assert.match(response, /not a scientific result/);
    assert.doesNotMatch(response, /orf count:|molecular weight:|isoelectric point:/i);
    assert.match(fixedResearchProposalReply(protocol), /Please review and approve/);
    assert.doesNotMatch(offlineResearchReply(protocol), /I can run.*No analysis has started/);
  }
});

test("V28 offline response is persisted once without provider calls, consent, or queueing", () => {
  const save = route.indexOf('const reply = offlineResearchReply(requestedFixedProtocol);');
  const finish = route.indexOf('service.rpc("finish_ai_chat_turn"', save);
  const status = route.indexOf('status: "research_unavailable"', finish);
  const fallback = route.indexOf('const providerResult = await startStreamingChat(', status);
  assert.ok(save > 0 && finish > save && status > finish && fallback > status);
  const segment = route.slice(save, fallback);
  assert.match(segment, /if \(finishError\) throw/);
  assert.match(segment, /requires_confirmation: false/);
  assert.match(segment, /return;/);
  assert.doesNotMatch(segment, /approve_chat_research_pipeline|request_research_|research_pipeline_run_id\s*:/);
  assert.match(route, /requestedFixedProtocol && !offerFixedResearch/);
  assert.match(route, /attachmentIds\.length === 0 &&\s*mediaAttachments\.length === 0/);
  assert.match(route, /parseChatResearchProtocol\(row\.user_message\)/);
});

test("V28 recoverable request is a suggestion, never retroactive research consent", () => {
  assert.deepEqual(latestRecoverableResearchRequest([]), null);
  const old = {...base, content:"Calculate protein properties for NP_000537.3"};
  const newSafe = {...base};
  assert.deepEqual(latestRecoverableResearchRequest([old,newSafe]), newSafe);
  for (const changed of [
    {role:"assistant"},
    {protocol_input_scope:"text_only"},
    {protocol_input_scope:"with_attachments"},
    {research_pipeline_run_id:"a-run"},
    {attachment_upload_ids:["a-sequence"]},
    {plan_request_id:"a-plan"},
    {content:"Please do NOT run ORF analysis on NM_000546.6"},
    {content:"Run an executable Python ORF script for NM_000546.6"},
    {content:"Run ORF scan on NM_000546.6 and NM_000001.1"},
  ]) {
    assert.equal(latestRecoverableResearchRequest([{...base,...changed}]),null,JSON.stringify(changed));
  }
  assert.deepEqual(latestRecoverableResearchRequest([old,{...base,role:"assistant"}]),old);
});

test("V28 conversation offers replay only when healthy; never invokes approval on replay", () => {
  assert.match(page, /const retryableRequest = scienceWorkersAvailable/);
  assert.match(page, /latestRecoverableResearchRequest\(chronologicalMessages\)/);
  assert.match(page, /suggestions=\{retryableRequest/);
  assert.match(page, /nothing runs until you submit it and explicitly approve/);
  assert.match(composer, /onClick=\{\(\) => \{ setMessage\(suggestion\); textareaRef\.current\?\.focus\(\); \}\}/);
  assert.doesNotMatch(refresh,/approveChatResearchProtocol|startStreamingChat|fetch\(/);
});

test("V28 recovery refresh is visibility aware and does not run a job", () => {
  assert.match(refresh, /if \(!watching\) return/);
  assert.match(refresh, /document\.visibilityState === "visible"/);
  assert.match(refresh, /router\.refresh\(\)/);
  assert.match(refresh, /30_000/);
  assert.match(refresh, /window\.clearInterval\(interval\)/);
  assert.match(page, /watching=\{scienceV22Ready && !scienceWorkersAvailable\}/);
});
