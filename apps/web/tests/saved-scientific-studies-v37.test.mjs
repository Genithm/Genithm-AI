import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = path => readFileSync(new URL(path,import.meta.url),"utf8");
const sql=read("../../../supabase/migrations/20261016210000_saved_scientific_studies_v37.sql");
const actions=read("../app/dashboard/results/studies/actions.ts");
const library=read("../app/dashboard/results/studies/page.tsx");
const detail=read("../app/dashboard/results/studies/[id]/page.tsx");
const viewer=read("../components/verified-comparison-viewer.tsx");
const types=read("../lib/report-database.types.ts");

test("V37 saved study DB enforces owner RLS on all operations", () => {
  assert.match(sql,/create table public\.scientific_comparison_studies/);
  assert.match(sql,/enable row level security/);
  for(const verb of ["select","insert","update","delete"]){
    assert.match(sql,new RegExp("for "+verb+" to authenticated"));
  }
  assert.match(sql,/created_by=\(select auth\.uid\(\)\)/);
  assert.match(sql,/app_private\.is_org_member\(organization_id\)/);
  assert.match(sql,/revoke all on public\.scientific_comparison_studies from public, anon/);
  assert.doesNotMatch(sql,/grant .* to anon/);
});

test("V37 source selections are DB-attested, same-project, owner-scoped and immutable", () => {
  assert.match(sql,/cardinality\(job_ids\) between 2 and 4/);
  assert.match(sql,/select distinct unnest\(new\.job_ids\)/);
  assert.match(sql,/j\.requested_by=actor/);
  assert.match(sql,/j\.project_id=new\.project_id/);
  assert.match(sql,/j\.organization_id=org/);
  assert.match(sql,/j\.status='completed'/);
  assert.match(sql,/j\.job_type=new\.job_type/);
  assert.match(sql,/new\.source_sha256 := hashes/);
  assert.match(sql,/new\.tool_versions := versions/);
  assert.match(sql,/new\.job_ids is distinct from old\.job_ids/);
  assert.match(sql,/new\.source_sha256 is distinct from old\.source_sha256/);
  assert.match(sql,/before insert or update/);
});

test("V37 save action independently checks source metadata after verified viewer", () => {
  assert.match(actions,/getClaims\(\)/g);
  assert.match(actions,/parseComparisonIds/);
  assert.match(actions,/\.eq\("requested_by", userId\)/);
  assert.match(actions,/\.in\("id", ids\)/);
  assert.match(actions,/job\.project_id !== first\.project_id/);
  assert.match(actions,/job\.result_sha256 !== supplied\[index\]/);
  assert.match(actions,/\.from\("scientific_comparison_studies"\)/);
  assert.match(actions,/\.select\("id"\)\.maybeSingle\(\)/);
  assert.doesNotMatch(actions,/source_sha256:\s*supplied|createServiceClient\s*\(|SUPABASE_SECRET_KEY/);
});

test("V37 saved study reopen rejects changed metadata and re-verifies scientific artifact", () => {
  assert.match(detail,/getClaims\(\)/);
  assert.match(detail,/\.eq\("created_by",userId\)/);
  assert.match(detail,/\.eq\("requested_by",userId\)/);
  assert.match(detail,/job\.result_sha256===study\.source_sha256\[i\]/);
  assert.match(detail,/job\.tool_version===study\.tool_versions\[i\]/);
  assert.match(detail,/job\.status==="completed"/);
  assert.match(detail,/safe \? <VerifiedComparisonViewer jobs=\{jobs\} allowSave=\{false\}/);
  assert.match(detail,/Stored evidence is no longer consistent/);
  assert.match(viewer,/data\.verification !== "sha256-verified"/);
  assert.match(viewer,/data\.sha256 !== job\.sha256/);
  assert.match(viewer,/saveScientificComparisonStudy/);
  assert.match(viewer,/status === "error" \|\| !comparison/);
});

test("V37 saved study library and original comparison UI are linked", () => {
  const results=read("../app/dashboard/results/page.tsx");
  const nav=read("../components/dashboard-primary-nav.tsx");
  const dock=read("../components/genithm-tool-dock.tsx");
  const sidebar=read("../components/research-chat-sidebar.tsx");
  assert.match(library,/getClaims\(\)/);
  assert.match(library,/\.eq\("created_by",userId\)/);
  assert.match(library,/\.in\("project_id"/);
  assert.match(library,/role="alert"/);
  assert.match(types,/scientific_comparison_studies: ScientificComparisonStudy/);
  assert.match(results,/href="\/dashboard\/results\/studies"/);
  assert.match(nav,/href:"\/dashboard\/results\/studies"/);
  assert.match(dock,/href="\/dashboard\/results\/studies"/);
  assert.match(sidebar,/href="\/dashboard\/results\/studies"/);
  assert.match(viewer,/verified_sha256/);
  assert.match(viewer,/Save verified source selection/);
});
