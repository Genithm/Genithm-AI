import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  SCIENCE_QUEUES,
  SCIENCE_WORKERS,
  scienceOperationsStatus,
} from "../lib/science-operations-status.ts";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const adminPage = source("../app/dashboard/admin/science/page.tsx");
const adminApi = source("../app/api/admin/science/health/route.ts");
const server = source("../lib/science-operations-server.ts");
const homepage = source("../app/dashboard/ai/page.tsx");
const refresh = source("../components/science-operations-refresh.tsx");

const snapshot = () => ({
  status: "ready",
  checked_at: new Date().toISOString(),
  expected_worker_count: 6,
  expected_queue_count: 9,
  worker_heartbeat_stale_after_seconds: 300,
  missing_workers: [],
  stale_workers: [],
  missing_queues: [],
  stale_queues: [],
  total_backlog: 0,
  max_worker_heartbeat_age_seconds: 22,
  max_oldest_message_age_seconds: null,
});

test("V29 ready report returns bounded six-worker and nine-queue telemetry", () => {
  const status = scienceOperationsStatus(snapshot());
  assert.equal(status.schemaVersion, "genithm-science-operations/1");
  assert.equal(status.health, "ready");
  assert.equal(status.workers.length, 6);
  assert.equal(status.queues.length, 9);
  assert.deepEqual(status.workers.map((x) => x.kind), SCIENCE_WORKERS);
  assert.deepEqual(status.queues.map((x) => x.kind), SCIENCE_QUEUES);
  assert.ok(status.workers.every((x) => x.health === "heartbeat_current"));
  assert.ok(status.queues.every((x) => x.health === "normal"));
  assert.equal(status.totalQueuedMessages, 0);
  assert.equal(status.oldestWorkerHeartbeatSeconds, 22);
  assert.equal(status.oldestQueuedMessageSeconds, null);
  assert.deepEqual(status.warnings, []);
  assert.ok(!("raw" in status));
});

test("V29 currently stale Genithm-style runtime reports blockers without claiming completed research", () => {
  const stale = scienceOperationsStatus({
    ...snapshot(),
    status: "not_ready",
    stale_workers: [...SCIENCE_WORKERS],
    max_worker_heartbeat_age_seconds: 349922,
  });
  assert.equal(stale.health, "blocked");
  assert.equal(stale.workers.length, 6);
  assert.ok(stale.workers.every((x) => x.health === "stale"));
  assert.match(stale.warnings.join(" "), /6 worker heartbeats older than 300 seconds/);
  assert.ok(stale.queues.every((x) => x.health === "normal"));
  assert.equal(stale.totalQueuedMessages, 0);
  assert.equal(stale.checkedAt?.length > 0, true);
});

test("V29 reports missing/stale workers and queue trouble independently", () => {
  const report = scienceOperationsStatus({
    ...snapshot(),
    status: "not_ready",
    missing_workers: ["source_worker"],
    stale_workers: ["scientific_worker"],
    missing_queues: ["ncbi_sequence_retrieval"],
    stale_queues: ["scientific_standard"],
    total_backlog: 5,
    max_oldest_message_age_seconds: 2000,
  });
  assert.equal(report.health, "blocked");
  const workers = Object.fromEntries(report.workers.map((x) => [x.kind,x.health]));
  const queues = Object.fromEntries(report.queues.map((x) => [x.kind,x.health]));
  assert.equal(workers.source_worker, "missing");
  assert.equal(workers.scientific_worker, "stale");
  assert.equal(workers.ai_worker, "heartbeat_current");
  assert.equal(queues.ncbi_sequence_retrieval, "missing");
  assert.equal(queues.scientific_standard, "stale_backlog");
  assert.equal(queues.sequence_validation, "normal");
  assert.equal(report.warnings.length, 4);
});

test("V29 rejects corrupt, replayed, incomplete and contradictory readiness snapshots", () => {
  const baseline = snapshot();
  const invalid = [
    null, undefined, 4, "ready", {}, [],
    {...baseline,status:"completed"},
    {...baseline,status:"not_ready",checked_at:"invalid"},
    {...baseline,checked_at:new Date(Date.now()-90_000).toISOString()},
    {...baseline,checked_at:new Date(Date.now()+90_000).toISOString()},
    {...baseline,expected_worker_count:5},
    {...baseline,expected_worker_count:"6"},
    {...baseline,expected_queue_count:8},
    {...baseline,worker_heartbeat_stale_after_seconds:900},
    {...baseline,worker_heartbeat_stale_after_seconds:0},
    {...baseline,missing_workers:null},
    {...baseline,missing_queues:["unknown_queue"]},
    {...baseline,stale_workers:["evil_user_name"]},
    {...baseline,missing_workers:["source_worker","source_worker"]},
    {...baseline,missing_queues:["ncbi_sequence_retrieval","ncbi_sequence_retrieval"]},
    {...baseline,missing_workers:["source_worker"],stale_workers:["source_worker"]},
    {...baseline,missing_queues:["ncbi_sequence_retrieval"],stale_queues:["ncbi_sequence_retrieval"]},
    {...baseline,total_backlog:-1},
    {...baseline,total_backlog:Infinity},
    {...baseline,max_worker_heartbeat_age_seconds:"yesterday"},
    {...baseline,max_oldest_message_age_seconds:-8},
  ];
  for (const input of invalid) {
    const result = scienceOperationsStatus(input);
    assert.equal(result.health, "unavailable", JSON.stringify(input));
    assert.equal(result.checkedAt, null);
    assert.ok(result.workers.every((x) => x.health === "unknown"));
    assert.ok(result.queues.every((x) => x.health === "unknown"));
  }
});

test("V29 does not trust a reported ready status if worker or queue facts disagree", () => {
  const report = scienceOperationsStatus({
    ...snapshot(),
    status:"ready",
    stale_workers:["source_worker"],
  });
  assert.equal(report.health,"blocked");
  assert.equal(report.workers.find((x) => x.kind === "source_worker").health,"stale");
  const report2 = scienceOperationsStatus({...snapshot(),status:"not_ready"});
  assert.equal(report2.health,"blocked");
  assert.match(report2.warnings.join(" "),/not confirmed/);
});

test("V29 never echoes raw secret, arbitrary DB keys, or queue data to the output", () => {
  const secret = "never_leak_this_private_key";
  const report = scienceOperationsStatus({
    ...snapshot(),
    worker_version: secret,
    user_id:secret,
    sequence_payload:secret,
    result_sha256:secret,
    queue_messages:[{body:secret}],
  });
  const serialized = JSON.stringify(report);
  assert.doesNotMatch(serialized,new RegExp(secret));
  assert.equal(report.health,"ready");
});

test("V29 endpoint authenticates by DB entitlement before any privileged service lookup", () => {
  const claims = adminApi.indexOf("user.auth.getClaims()");
  const check = adminApi.indexOf('user.rpc("is_platform_admin")');
  const privileged = adminApi.indexOf("await readScienceOperationsOverview()");
  assert.ok(claims > 0 && check > claims && privileged > check);
  assert.match(adminApi,/admin !== true/);
  assert.match(adminApi,/return json\(\{ error: "Not found" \}, 404\)/);
  assert.match(adminApi,/return json\(\{ error: "Authentication required" \}, 401\)/);
  assert.match(adminApi,/export const dynamic = "force-dynamic"/);
  assert.match(adminApi,/private, no-store, max-age=0/);
  assert.doesNotMatch(adminApi,/service_role|secret_key|SUPABASE_SECRET_KEY|NEXT_PUBLIC_/);
  assert.doesNotMatch(adminApi,/request\.json\(|request\.nextUrl\.searchParams/);
  assert.doesNotMatch(adminApi,/POST\(|PUT\(|DELETE\(/);
});

test("V29 dashboard gates privileged data by original end-user DB role", () => {
  const claims = adminPage.indexOf("user.auth.getClaims()");
  const check = adminPage.indexOf('user.rpc("is_platform_admin")');
  const privileged = adminPage.indexOf("await readScienceOperationsOverview()");
  assert.ok(claims > 0 && check > claims && privileged > check);
  assert.match(adminPage,/admin !== true\) notFound\(\)/);
  assert.match(adminPage,/status\.workers\.map/);
  assert.match(adminPage,/status\.queues\.map/);
  assert.match(adminPage,/pipelineCounts/);
  assert.match(adminPage,/overview\.acceptance/);
  assert.match(adminPage,/No.*scientific evidence|not scientific evidence/);
  assert.doesNotMatch(adminPage,/service_role|SUPABASE_SECRET_KEY|NEXT_PUBLIC_/);
});

test("V29 server fetches only service-owned aggregates and masks RPC failures", () => {
  assert.match(server,/import "server-only"/);
  assert.match(server,/createServiceClient\(\)/);
  assert.match(server,/service\.rpc\("get_release_readiness"\)/);
  assert.match(server,/\.limit\(0\)/);
  assert.match(server,/\.select\("id", \{ count: "exact", head: true \}\)/);
  assert.match(server,/\.eq\("status", state\)/);
  assert.match(server,/scienceOperationsStatus\(readiness\.error \? null : readiness\.data\)/);
  assert.match(server,/catch\s*\{/);
  assert.match(server,/acceptance: "blocked"/);
  assert.doesNotMatch(server,/rawError:|error\.message|JSON\.stringify\(error\)/);
});

test("V29 refresh is periodic but makes no privileged browser RPCs or mutations", () => {
  assert.match(refresh,/document\.visibilityState === "visible"/);
  assert.match(refresh,/router\.refresh\(\)/);
  assert.match(refresh,/30_000/);
  assert.match(refresh,/clearInterval\(timer\)/);
  assert.doesNotMatch(refresh,/fetch\(|approve|submit|createServiceClient/);
});

test("V29 researcher homepage displays only a generic readiness notice", () => {
  assert.match(homepage,/if \(!claimsData\?\.claims\?\.sub\) redirect\("\/login"\)/);
  assert.match(homepage,/researchConfigured && !researchAvailable/);
  assert.match(homepage,/scientific services recover/);
  assert.doesNotMatch(homepage,/stale_workers|missing_workers|SUPABASE_SECRET_KEY|get_release_readiness/);
});
