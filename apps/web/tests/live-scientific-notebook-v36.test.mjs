import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const sql = read("../../../supabase/migrations/20261016140004_scientific_notebook_v36.sql");
const page = read("../app/dashboard/notebook/page.tsx");
const actions = read("../app/dashboard/notebook/actions.ts");
const types = read("../lib/report-database.types.ts");

test("V36 migration creates a secure owner-only research notebook with RLS", () => {
  assert.match(sql, /create table public\.scientific_notebook_entries/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /for select to authenticated/);
  assert.match(sql, /for insert to authenticated/);
  assert.match(sql, /for update to authenticated/);
  assert.match(sql, /for delete to authenticated/);
  assert.match(sql, /created_by = \(select auth\.uid\(\)\)/);
  assert.match(sql, /app_private\.is_org_member\(organization_id\)/);
  assert.match(sql, /revoke all on public\.scientific_notebook_entries from public, anon/);
  assert.doesNotMatch(sql, /grant .* on public\.scientific_notebook_entries to anon/);
});

test("V36 source result fingerprints are selected by database, never passed from browser", () => {
  assert.match(sql, /app_private\.validate_scientific_notebook_entry/);
  assert.match(sql, /new\.source_result_sha256 := source_hash/);
  assert.match(sql, /new\.scientific_job_id/);
  assert.match(sql, /j\.project_id = new\.project_id/);
  assert.match(sql, /j\.requested_by = actor/);
  assert.match(sql, /j\.status = 'completed'/);
  assert.match(sql, /new\.project_id is distinct from old\.project_id/);
  assert.match(sql, /new\.source_result_sha256 is distinct from old\.source_result_sha256/);
  assert.match(sql, /before insert or update/);
  assert.doesNotMatch(actions, /source_result_sha256:/);
});

test("V36 typed Supabase access uses researcher's claims and no service credentials", () => {
  assert.match(types, /scientific_notebook_entries: ScientificNotebookEntry/);
  assert.match(actions, /getClaims\(\)/g);
  assert.match(actions, /\.eq\("created_by", userId\)/g);
  assert.match(actions, /\.from\("scientific_notebook_entries"\)/g);
  assert.match(actions, /revalidatePath\("\/dashboard\/notebook"\)/);
  assert.match(page, /\.eq\("created_by", userId\)/);
  assert.match(page, /scientific_job_id/);
  assert.match(page, /source_result_sha256/);
  assert.doesNotMatch(actions, /createServiceClient\s*\(|SUPABASE_SECRET_KEY|service_role\s*\)/);
  assert.doesNotMatch(page, /createServiceClient\s*\(|SUPABASE_SECRET_KEY/);
});

test("V36 researchers can write, edit, filter and remove their own notes", () => {
  assert.match(page, /createScientificNotebookEntry/);
  assert.match(page, /updateScientificNotebookEntry/);
  assert.match(page, /deleteScientificNotebookEntry/);
  assert.match(page, /role="alert"/);
  assert.match(page, /role="status"/);
  assert.match(page, /name="project"/);
  assert.match(page, /name="kind"/);
  assert.match(page, /Link.*Scientific results/);
  assert.match(actions, /parseTags/);
  assert.match(actions, /8000/);
  assert.match(page, /researcher-authored notes/i);
  assert.doesNotMatch(page, /mock|fakeScientific|Math\.random/);
});

test("V36 notebook is linked from actual scientific job, results and AI workspace", () => {
  const details = read("../app/dashboard/scientific-jobs/[id]/page.tsx");
  const results = read("../app/dashboard/results/page.tsx");
  const nav = read("../components/dashboard-primary-nav.tsx");
  const sidebar = read("../components/research-chat-sidebar.tsx");
  const dock = read("../components/genithm-tool-dock.tsx");
  assert.match(details, /Record research note/);
  assert.match(details, /dashboard\/notebook\?project=/);
  assert.match(results, /href="\/dashboard\/notebook"/);
  assert.match(nav, /href:"\/dashboard\/notebook"/);
  assert.match(sidebar, /href="\/dashboard\/notebook"/);
  assert.match(dock, /href="\/dashboard\/notebook"/);
});
