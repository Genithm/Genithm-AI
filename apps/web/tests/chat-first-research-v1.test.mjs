import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const thread = read("../app/dashboard/ai/[id]/page.tsx");
const actions = read("../app/dashboard/ai/actions.ts");
const composer = read("../components/ai-chat-composer.tsx");
const home = read("../app/dashboard/ai/page.tsx");
const poller = read("../components/research-activity-refresh.tsx");

test("approved analysis remains in chat; never forces separate results navigation", () => {
  assert.match(actions, /redirect\(\x60\/dashboard\/ai\/\$\{conversationId\}\x60\)/);
  assert.doesNotMatch(actions, /redirect\(\x60\/dashboard\/scientific-jobs\//);
  assert.doesNotMatch(actions, /redirect\(\x60\/dashboard\/protein-annotations\//);
});

test("research progress and verified metrics are in the same chat before composer", () => {
  assert.match(thread, /Research activity &amp; results/);
  assert.match(thread, /scientific_jobs"\)\.select\("id,status,job_type,result_summary,result_sha256/);
  assert.match(thread, /recordedEvidenceMetrics\(evidenceType, evidenceRow\)/);
  assert.match(thread, /Recorded result fingerprint/);
  assert.match(thread, /Approve this analysis/);
  assert.ok(thread.indexOf('<details className={styles.activity}') < thread.lastIndexOf('<AiChatComposer'));
});

test("chat refresh is bounded and only runs for active jobs in visible tabs", () => {
  assert.match(poller, /if \(!active\) return/);
  assert.match(poller, /document.visibilityState === "visible"/);
  assert.match(poller, /5000/);
  assert.match(poller, /window.clearInterval\(timer\)/);
});

test("examples populate the real chat composer instead of decorative boxes", () => {
  assert.match(home, /quickActions=\{researchActions\}/);
  assert.match(composer, /setMessage\(action\.prompt\)/);
  assert.match(composer, /textareaRef\.current\?\.focus\(\)/);
});

test("authenticated uploads and fixed scientific approval remain intact", () => {
  assert.match(composer, /getSession\(\)/);
  assert.match(composer, /storage\/sequence-uploads/);
  assert.match(actions, /supabase\.rpc\("approve_ai_plan"/);
});
