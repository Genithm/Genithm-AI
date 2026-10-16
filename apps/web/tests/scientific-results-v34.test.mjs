import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  activityFilter, activityScope, activityTitle, classifyActivity, sortActivityRows,
  statusLabel, statusQueryFilter,
} from "../lib/scientific-activity.ts";

const read = (file) => readFileSync(new URL(file, import.meta.url), "utf8");

test("V34 scientific status mapping never fabricates completion", () => {
  assert.equal(classifyActivity("scientific","queued"), "active");
  assert.equal(classifyActivity("scientific","validating_result"), "active");
  assert.equal(classifyActivity("pipeline","awaiting_validation"), "active");
  assert.equal(classifyActivity("pipeline","completed"), "completed");
  assert.equal(classifyActivity("scientific","failed"), "stopped");
  assert.equal(classifyActivity("scientific","cancelled"), "stopped");
  assert.equal(classifyActivity("scientific","mysterious_status"), "unknown");
  assert.equal(statusLabel("mysterious_status"), "Status unavailable");
  assert.equal(activityTitle("scientific","phylogenetic_tree"), "Phylogenetic tree");
  assert.equal(activityTitle("pipeline","ncbi_nucleotide_orf_v1"), "NCBI nucleotide → ORF scan");
});

test("V34 filter parsing and server-side status allowlists are fail-closed", () => {
  assert.equal(activityFilter("something_else"),null);
  assert.equal(activityScope("other"),null);
  assert.equal(activityFilter(undefined),"all");
  assert.equal(activityScope(undefined),"all");
  assert.deepEqual(statusQueryFilter("scientific","completed"),["completed"]);
  assert.ok(statusQueryFilter("scientific","active").includes("validating_result"));
  assert.ok(statusQueryFilter("pipeline","active").includes("awaiting_source"));
  assert.ok(statusQueryFilter("scientific","stopped").includes("cancelled"));
  assert.equal(statusQueryFilter("pipeline","all"),null);
});

test("V34 sorts only input records without mutating them", () => {
  const first = {id:"first", kind:"scientific", createdAt:"2026-01-01T00:00:00Z"};
  const second = {id:"second", kind:"pipeline", createdAt:"2026-02-01T00:00:00Z"};
  const items = [first, second];
  const sorted = sortActivityRows(items);
  assert.deepEqual(sorted.map((x)=>x.id),["second","first"]);
  assert.deepEqual(items.map((x)=>x.id),["first","second"]);
});

test("V34 results route only queries authenticated owner-scoped records", () => {
  const route = read("../app/dashboard/results/page.tsx");
  assert.match(route,/getClaims\(\)/);
  assert.match(route,/redirect\("\/login"\)/);
  assert.match(route,/from\("projects"\)/);
  assert.match(route,/from\("scientific_jobs"\)/);
  assert.match(route,/from\("research_pipeline_runs"\)/);
  assert.match(route,/\.eq\("requested_by", userId\)/g);
  assert.match(route,/\.in\("project_id", projectIds\)/g);
  assert.match(route,/statusQueryFilter\(/);
  assert.match(route,/invalid/);
  assert.match(route,/loadError/);
  assert.match(route,/Scientific activity could not be loaded securely/);
  assert.match(route,/ResearchActivityRefresh active=/);
  assert.doesNotMatch(route,/createServiceClient\s*\(|SUPABASE_SECRET_KEY|Math\.random/);
});

test("V34 live dock only presents stored science and uses existing detail links", () => {
  const home = read("../app/dashboard/ai/page.tsx");
  const dock = read("../components/genithm-tool-dock.tsx");
  const nav = read("../components/dashboard-primary-nav.tsx");
  assert.match(home,/\.eq\("requested_by", claims\.claims\.sub\)/);
  assert.match(home,/\.limit\(4\)/);
  assert.match(home,/recentRunsError=/);
  assert.match(dock,/recentRuns\.map/);
  assert.match(dock,/classifyActivity\("scientific", run\.status\)/);
  assert.match(dock,/href="\/dashboard\/results"/);
  assert.match(dock,/\/dashboard\/scientific-jobs\//);
  assert.match(nav,/href:"\/dashboard\/results"/);
  assert.doesNotMatch(dock,/mockResult|fakeProgress|Math\.random/);
});
