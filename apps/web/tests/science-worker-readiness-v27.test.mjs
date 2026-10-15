import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { scienceWorkersReady } from "../lib/science-worker-readiness.ts";
const source = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

const ready = () => ({
  status: "ready",
  checked_at: new Date().toISOString(),
  missing_workers: [],
  stale_workers: [],
  missing_queues: [],
  stale_queues: [],
  expected_worker_count: 6,
  expected_queue_count: 9,
  worker_heartbeat_stale_after_seconds: 300,
});

test("V27 only fresh, complete server readiness authorizes science", () => {
  assert.equal(scienceWorkersReady(ready()), true);
  for (const x of [null, [], 7, "ready", {}, {status:"ready"}]) {
    assert.equal(scienceWorkersReady(x), false);
  }
  for (const k of ["missing_workers", "stale_workers","missing_queues", "stale_queues"]) {
    assert.equal(scienceWorkersReady({ ...ready(), [k]: ["source_worker"] }), false, k);
    assert.equal(scienceWorkersReady({ ...ready(), [k]: null }), false, k);
  }
  for (const x of [
    {status:"not_ready"},
    {expected_worker_count:5},
    {expected_queue_count:8},
    {worker_heartbeat_stale_after_seconds:900},
    {checked_at:"invalid"},
    {checked_at:new Date(Date.now()-61_000).toISOString()},
    {checked_at:new Date(Date.now()+61_000).toISOString()},
  ]) assert.equal(scienceWorkersReady({...ready(), ...x}),false,JSON.stringify(x));
});

test("V27 service-role RPC cannot be controlled by form data or browser", () => {
  const server = source("../lib/science-execution-readiness.ts");
  assert.match(server, /import "server-only"/);
  assert.match(server, /createServiceClient/);
  assert.match(server, /\.rpc\("get_release_readiness"\)/);
  assert.match(server, /return !error && scienceWorkersReady\(data\)/);
  assert.match(server, /catch\s*\{\s*return false/);
  assert.doesNotMatch(server, /NEXT_PUBLIC_/);
});

test("V27 chat proposal requires worker readiness and preserves normal chat fallback", () => {
  const page = source("../app/dashboard/ai/[id]/page.tsx");
  const route = source("../app/api/ai/chat/route.ts");
  assert.match(route, /if \(!schemaError && await scienceExecutionReady\(service\)\)/);
  assert.match(route, /offerFixedResearch = !inputScopeError/);
  assert.match(route, /const fixedProtocol = offerFixedResearch &&/);
  assert.match(route, /const providerResult = await startStreamingChat\(/);
  assert.match(page, /const scienceWorkersAvailable = scienceV22Ready && await scienceExecutionReady\(\)/);
  assert.match(page, /\{scienceWorkersAvailable && message\.role === "user"/);
  assert.match(page, /Scientific workers are currently offline or not ready/);
});

test("V27 approval rechecks readiness immediately before original-message lookup and enqueue", () => {
  const actions = source("../app/dashboard/ai/actions.ts");
  const check = actions.indexOf("if (!await scienceExecutionReady())");
  const select = actions.indexOf('const { data: source } = await supabase.from("ai_messages")');
  const approval = actions.indexOf('supabase.rpc("approve_chat_research_pipeline"');
  assert.ok(check !== -1 && check < select && select < approval);
  assert.match(actions, /request was not approved or queued/);
  assert.doesNotMatch(actions, /formData\.get\("worker_ready"\)/);
});
