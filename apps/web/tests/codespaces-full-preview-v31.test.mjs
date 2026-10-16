import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(p, import.meta.url),"utf8");
const home = read("../app/page.tsx");
const nav = read("../app/layout.tsx");
const preview = read("../app/preview/page.tsx");
const launcher = read("../../../scripts/codespaces_preview.sh");
const devStart = read("../../../.devcontainer/start.sh");
const devSetup = read("../../../.devcontainer/setup.sh");
const guide = read("../../../docs/deployment/CODESPACES_FULL_PREVIEW.md");

test("V31 real product homepage always features sign-in and signup, not a sample demo",()=>{
  assert.match(home,/href="\/login">Sign In to Genithm/);
  assert.match(home,/href="\/signup">Create Research Account/);
  assert.doesNotMatch(home,/Open Development Preview/);
  assert.doesNotMatch(home,/href="\/preview"/);
  assert.match(nav,/href="\/login">Sign in/);
  assert.match(nav,/href="\/signup">Create account/);
  assert.doesNotMatch(nav,/href="\/preview"/);
  assert.doesNotMatch(home,/Live scientific orchestration layer/);
});

test("V31 local fixture mode is clearly distinguished from the real Genithm app",()=>{
  assert.match(preview,/GENITHM_CODESPACES_PREVIEW/);
  assert.match(preview,/process\.env\.NODE_ENV !== "development"/);
  assert.match(preview,/notFound\(\)/);
  assert.match(preview,/SAMPLE-ONLY DEVELOPMENT WORKBENCH/);
  assert.match(preview,/href="\/login">Sign in to the full Genithm app/);
  assert.match(preview,/bash scripts\/codespaces_preview\.sh/);
  assert.doesNotMatch(preview,/Use a separate development Supabase project/);
  assert.match(devSetup,/Local SAMPLE workbench/);
  assert.match(devStart,/Basic development web server/);
});

test("V31 full launcher requires secrets, avoids public leakage, and configures server V22 runtime",()=>{
  assert.match(launcher,/required=\(SUPABASE_SECRET_KEY OPENROUTER_API_KEY\)/);
  assert.match(launcher,/NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=\$SUPABASE_PUBLISHABLE_KEY/);
  assert.match(launcher,/SUPABASE_SECRET_KEY=\$SUPABASE_SECRET_KEY/);
  assert.match(launcher,/GENITHM_SCIENCE_V22_ENABLED=true/);
  assert.match(launcher,/GENITHM_LOCAL_API_PROXY_TARGET=http:\/\/127\.0\.0\.1:8000/);
  assert.match(launcher,/chmod 600 "\$WEB_DIR\/\.env\.local"/);
  assert.doesNotMatch(launcher,/NEXT_PUBLIC_SUPABASE_SECRET_KEY/);
  assert.doesNotMatch(launcher,/NEXT_PUBLIC_OPENROUTER_API_KEY/);
  assert.match(launcher,/GENITHM_AI_PRIMARY_PROVIDER=openrouter/);
  assert.match(launcher,/api\/v1\/health/);
  assert.match(launcher,/rest\/v1\/rpc\/get_release_readiness/);
  assert.match(launcher,/Genithm FULL preview is running and passed readiness checks/);
  assert.match(launcher,/Open your real sign-in page: \$WEB_ORIGIN\/login/);
  assert.match(launcher,/Create an account: \$WEB_ORIGIN\/signup/);
});

test("V31 old Codespaces fixture server cannot silently absorb the configured full preview",()=>{
  assert.match(devStart,/WEB_PID="\$ROOT\/\.codespaces-web\.pid"/);
  assert.match(devStart,/echo \$! > "\$WEB_PID"/);
  assert.match(launcher,/if \[\[ -f "\$WEB_PID" \]\] && kill -0/);
  assert.match(launcher,/Replacing existing Codespaces development server/);
  assert.match(launcher,/fuser -k 3000\/tcp/);
  assert.match(launcher,/Port 3000 is still busy/);
  assert.match(launcher,/WEB_LOG="\$ROOT_DIR\/\.codespaces-web\.log"/);
});

test("V31 documentation matches the actual OpenRouter launcher and existing project, not obsolete DeepSeek-only instructions",()=>{
  assert.match(guide,/OpenRouter/);
  assert.match(guide,/OPENROUTER_API_KEY/);
  assert.match(guide,/SUPABASE_SECRET_KEY/);
  assert.match(guide,/bash scripts\/codespaces_preview\.sh/);
  assert.match(guide,/\/login/);
  assert.match(guide,/\/signup/);
  assert.match(guide,/six current worker heartbeats/);
  assert.match(guide,/existing Genithm Supabase project/);
  assert.doesNotMatch(guide,/Create a new Supabase project/);
  assert.doesNotMatch(guide,/requires DeepSeek/);
});
