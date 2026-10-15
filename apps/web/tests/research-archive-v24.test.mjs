import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ARCHIVE_PAGE_SIZE, archiveCursorPredicate, archiveStatus, archiveTemplate,
  isUuid, parseResearchArchiveSearch, researchArchiveHref,
} from "../lib/research-archive.ts";

const userProject = "11111111-1111-4111-8111-111111111111";
const oldest = "22222222-2222-4222-8222-222222222222";
const time = "2026-10-15T12:30:40.123456+00:00";
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("V24 archive parameters are strict untrusted locators, not authorization", () => {
  assert.equal(ARCHIVE_PAGE_SIZE, 25);
  assert.equal(isUuid(userProject), true);
  assert.equal(isUuid("bad' or true"), false);
  assert.deepEqual(parseResearchArchiveSearch({}), { projectId:null,cursor:null,invalid:false });
  assert.deepEqual(parseResearchArchiveSearch({project:""}), { projectId:null,cursor:null,invalid:false });
  assert.deepEqual(parseResearchArchiveSearch({project:userProject}), { projectId:userProject,cursor:null,invalid:false });
  assert.deepEqual(parseResearchArchiveSearch({project:userProject,before_time:time,before_id:oldest}),
    { projectId:userProject,cursor:{time,id:oldest},invalid:false });
  for (const bad of [
    {project:"all;drop table"},
    {project:["",userProject]},
    {before_time:time},
    {before_id:oldest},
    {before_time:time,before_id:"(id.lt.fake)"},
    {before_time:"2026-10-15T12:30:40Z),and(id.neq.x)",before_id:oldest},
    {before_time:"garbage",before_id:oldest},
    {before_time:[time],before_id:oldest},
  ]) assert.equal(parseResearchArchiveSearch(bad).invalid,true,JSON.stringify(bad));
});

test("V24 keyset URL preserves exact UTC fractions and cannot inject PostgREST syntax", () => {
  const cursor={time,id:oldest};
  const href=researchArchiveHref(userProject,cursor);
  const parsed = new URL(href,"https://example.invalid");
  assert.equal(parsed.pathname,"/dashboard/ai/research");
  assert.equal(parsed.searchParams.get("project"),userProject);
  assert.equal(parsed.searchParams.get("before_time"),time);
  assert.equal(parsed.searchParams.get("before_id"),oldest);
  assert.deepEqual(parseResearchArchiveSearch(Object.fromEntries(parsed.searchParams)),{
    projectId:userProject,cursor,invalid:false,
  });
  assert.equal(archiveCursorPredicate(cursor),
    `created_at.lt.${time},and(created_at.eq.${time},id.lt.${oldest})`);
  assert.equal(researchArchiveHref(null,null),"/dashboard/ai/research");
  assert.equal(researchArchiveHref(userProject,null),"/dashboard/ai/research?project="+userProject);
});

test("V24 archive distinguishes recorded workflow status from verified findings", () => {
  assert.equal(archiveStatus("completed"),"Engine completed");
  assert.equal(archiveStatus("error"),"Engine failed");
  assert.equal(archiveStatus("running"),"Running computation");
  assert.equal(archiveStatus("anything else"),"Status unavailable");
  assert.equal(archiveTemplate("ncbi_nucleotide_orf_v1"),"NCBI nucleotide ORF analysis");
  assert.equal(archiveTemplate("ncbi_protein_profile_v1"),"NCBI protein properties");
  assert.equal(archiveTemplate("unsupported"),"Other recorded research");
});

test("V24 archive only retrieves persisted user-message links with explicit ownership", () => {
  const archive=read("../app/dashboard/ai/research/page.tsx");
  assert.match(archive,/supabase\.auth\.getClaims\(\)/);
  assert.match(archive,/\.from\("ai_messages"\)/);
  assert.match(archive,/\.eq\("conversation_owner_id", userId\)/);
  assert.match(archive,/\.eq\("role", "user"\)/);
  assert.match(archive,/\.not\("research_pipeline_run_id", "is", null\)/);
  assert.match(archive,/\.order\("created_at", \{ ascending: false \}\)/);
  assert.match(archive,/\.order\("id", \{ ascending: false \}\)/);
  assert.match(archive,/\.limit\(ARCHIVE_PAGE_SIZE \+ 1\)/);
  assert.match(archive,/\.or\(archiveCursorPredicate\(filter\.cursor\)\)/);
  assert.match(archive,/\.eq\("requested_by", userId\)/);
  assert.match(archive,/\.eq\("created_by", userId\)/);
  assert.match(archive,/pipeline\.project_id !== message\.project_id/);
  assert.match(archive,/conversation\.project_id !== message\.project_id/);
  assert.match(archive,/pipeline\.requested_by !== userId/);
  assert.match(archive,/conversation\.created_by !== userId/);
  assert.match(archive,/\.eq\("id", filter\.projectId\)\.maybeSingle\(\)/);
  assert.match(archive,/href=\{researchArchiveHref\(authorizedProjectId, nextCursor\)\}/);
  assert.match(archive,/source_message_id=\$\{item\.id\}/);
  assert.doesNotMatch(archive,/createServiceClient|service_role|supabaseAdmin/);
});

test("V24 deep links into old runs only after proving the original message is in this conversation", () => {
  const page=read("../app/dashboard/ai/[id]/page.tsx");
  assert.match(page,/const \{ data: historicalMessageLink \}/);
  assert.match(page,/\.eq\("conversation_id", conversation\.id\)/);
  assert.match(page,/\.eq\("conversation_owner_id", claimsData\.claims\.sub\)/);
  assert.match(page,/\.eq\("research_pipeline_run_id", candidatePipelineId\)/);
  assert.match(page,/linkedPipelineById\.has\(candidatePipelineId\) \|\| historicalMessageLink\?\.id/);
  assert.match(page,/\.eq\("requested_by", claimsData\.claims\.sub\)\.maybeSingle\(\)/);
  assert.match(page,/selectedOlderResearch/);
  assert.match(page,/\.select\("id,content,created_at"\)/);
  assert.match(page,/historicalMessageLink\.content/);
  assert.match(page,/source_message_id\?: string/);
  assert.match(page,/sourceMessageId = isUuid\(query\.source_message_id\)/);
  assert.match(page,/sourceLookup\.eq\("id", sourceMessageId\)\.maybeSingle\(\)/);
  assert.match(page,/\.order\("id", \{ ascending: false \}\)\.limit\(1\)\.maybeSingle\(\)/);
  assert.match(page,/exactSourceAuthorized/);
  assert.match(page,/query\.pipeline_id !== undefined \? requestedPipelineId/);
  assert.match(page,/historicalMessageLink\.content/);
  assert.match(page,/Recovered original approved request/);
  assert.match(page,/href="\/dashboard\/ai\/research"/);
});

test("V24 researcher-facing navigation makes the archive discoverable", () => {
  const home=read("../app/dashboard/ai/page.tsx");
  assert.match(home,/href="\/dashboard\/ai\/research"/);
  const archive=read("../app/dashboard/ai/research/page.tsx");
  assert.match(archive,/role="alert"/);
  assert.match(archive,/recorded workflow, not independently validated biological findings/);
  assert.doesNotMatch(archive,/Download verified research/);
});
