import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  scienceV22Configured, scienceSchemaReady, scienceSchemaUnavailableError,
} from "../lib/science-release.ts";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const chat = source("../app/api/ai/chat/route.ts");
const thread = source("../app/dashboard/ai/[id]/page.tsx");
const approval = source("../app/dashboard/ai/actions.ts");
const archive = source("../app/dashboard/ai/research/page.tsx");

test("V26 defaults science execution OFF unless server opts in explicitly", () => {
  const before = process.env.GENITHM_SCIENCE_V22_ENABLED;
  try {
    delete process.env.GENITHM_SCIENCE_V22_ENABLED;
    assert.equal(scienceV22Configured(), false);
    for (const value of ["", "false", "0", "TRUE", "yes", "enabled"]) {
      process.env.GENITHM_SCIENCE_V22_ENABLED = value;
      assert.equal(scienceV22Configured(), false, value);
    }
    process.env.GENITHM_SCIENCE_V22_ENABLED = "true";
    assert.equal(scienceV22Configured(), true);
  } finally {
    if (before === undefined) delete process.env.GENITHM_SCIENCE_V22_ENABLED;
    else process.env.GENITHM_SCIENCE_V22_ENABLED = before;
  }
});

test("V26 schema failure always disables approval, even with opt-in enabled", () => {
  assert.equal(scienceSchemaReady(false, null), false);
  assert.equal(scienceSchemaReady(true, null), true);
  assert.equal(scienceSchemaReady(true, {code:"42703"}), false);
  assert.equal(scienceSchemaReady(true, {code:"PGRST204"}), false);
  assert.equal(scienceSchemaReady(false, {code:"PGRST202"}), false);
});

test("V26 only missing schema/functions can fall back to ordinary chat", () => {
  for (const code of ["PGRST202","PGRST204","42703","42883"]) {
    assert.equal(scienceSchemaUnavailableError({code}),true,code);
  }
  for (const code of ["42501","P0002","23505","42P01","57014","22023","PGRST301"]) {
    assert.equal(scienceSchemaUnavailableError({code}),false,code);
  }
  assert.equal(scienceSchemaUnavailableError(null),false);
  assert.equal(scienceSchemaUnavailableError({message:"unauthorized"}),false);
});

test("V26 chat streams normally without V22 but never proposes unauthorized science", () => {
  assert.match(chat, /if \(scienceV22Configured\(\)\) \{/);
  assert.match(chat, /\.select\("id,protocol_input_scope,research_pipeline_run_id"\)\.limit\(0\)/);
  assert.match(chat, /if \(!schemaError && await scienceExecutionReady\(service\)\) \{/);
  assert.match(chat, /service\.rpc\("mark_chat_protocol_input_scope"/);
  assert.match(chat, /scienceSchemaUnavailableError\(inputScopeError\)/);
  assert.match(chat, /offerFixedResearch = !inputScopeError/);
  assert.match(chat, /const fixedProtocol = offerFixedResearch &&/);
  assert.match(chat, /const providerResult = await startStreamingChat\(/);
  assert.doesNotMatch(chat, /if \(inputScopeError\) throw/);
});

test("V26 existing chat history uses legacy columns before migration", () => {
  assert.match(thread, /const scienceV22Ready = scienceSchemaReady\(/);
  assert.match(thread, /\(scienceV22Ready\s*\? supabase\.from\("ai_messages"\)/);
  assert.match(thread, /\.select\("id,role,content,message_kind,plan_request_id,attachment_upload_ids,created_at"\)/);
  assert.match(thread, /"protocol_input_scope" in message &&/);
  assert.match(thread, /typeof message\.protocol_input_scope === "string"/);
  assert.match(thread, /"research_pipeline_run_id" in message &&/);
  assert.match(thread, /typeof message\.research_pipeline_run_id === "string"/);
  // V27 additionally requires fresh workers before offering a new approval.
  assert.match(thread, /scienceWorkersAvailable && message\.role === "user"/);
  assert.match(thread, /const scienceWorkersAvailable = scienceV22Ready && await scienceExecutionReady\(\)/);
  assert.match(thread, /scienceV22Ready && isUuid\(query\.pipeline_id\)/);
  assert.match(thread, /Chat remains available/);
});

test("V26 server actions reject forged approvals before querying science columns or RPC", () => {
  const gate = approval.indexOf("scienceSchemaReady(scienceV22Configured(), schemaError)");
  const sourceSelect = approval.indexOf('.select("id,role,content,conversation_id,conversation_owner_id,attachment_upload_ids,protocol_input_scope,research_pipeline_run_id")');
  const dispatch = approval.indexOf('supabase.rpc("approve_chat_research_pipeline"');
  assert.ok(gate > 0 && sourceSelect > gate && dispatch > sourceSelect);
  assert.match(approval, /Scientific protocol approval is not enabled on this database yet/);
});

test("V26 archive does not query V22 columns when migration is absent", () => {
  const gate = archive.indexOf("if (!scienceSchemaReady(scienceV22Configured(), scienceSchemaError))");
  const queries = archive.indexOf('.not("research_pipeline_run_id", "is", null)');
  assert.ok(gate > 0 && queries > gate);
  assert.match(archive, /The research archive will become available once the science database migration/);
  assert.doesNotMatch(archive, /createServiceClient|service_role/);
});
