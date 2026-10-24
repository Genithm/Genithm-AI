import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

const landing = read("../app/dashboard/ai/page.tsx");
const landingStyle = read("../app/dashboard/ai/chat.module.css");
const conversation = read("../app/dashboard/ai/[id]/page.tsx");
const conversationStyle = read("../app/dashboard/ai/[id]/conversation.module.css");
const composer = read("../components/ai-chat-composer.tsx");
const composerStyle = read("../components/ai-chat-composer.module.css");
const sidebar = read("../components/research-chat-sidebar.tsx");
const sidebarStyle = read("../components/research-chat-sidebar.module.css");
const navigation = read("../components/dashboard-primary-nav.tsx");
const onboarding = read("../app/dashboard/ai/onboarding-actions.ts");
const chatLauncher = read("../../../scripts/codespaces_bioai.sh");

test("V32 main dashboard remains an AI-first research conversation under the V40 simplification", () => {
  assert.match(landing,/What (?:can we discover today\?|would you like to analyze\?)/);
  assert.match(landing,/ResearchChatSidebar/);
  assert.match(landing,/AiChatComposer/);
  assert.match(landing,/quickActions=\{\[researchActions\[5\],researchActions\[2\],researchActions\[3\]\]\}/);
  assert.match(landing,/scienceReady=\{fixedScienceReady\}/);
  assert.match(landing,/from\("ai_conversations"\)/);
  assert.match(landing,/from\("projects"\)/);
  assert.match(landing,/from\("organizations"\)/);
  assert.match(landing,/supabase\.auth\.getClaims\(\)/);
  assert.match(landing,/scientific execution is currently unavailable/i);
  assert.doesNotMatch(landing,/href="\/preview"/);
  assert.doesNotMatch(landing,/Open Development Preview/);
});

test("V32 bioinformatics prompts remain real composer actions with three focused starters in V40",()=>{
  for(const label of ["DNA & RNA","Proteins","Compare sequences","Find similar sequences","Phylogenetics","Plan my research"]){
    assert.ok(landing.includes('label:"'+label+'"'),label);
  }
  assert.match(landing,/Run ORF scan on NM_000546\.6/);
  assert.match(landing,/Calculate protein properties for NP_000537\.3/);
  assert.match(composer,/type ResearchQuickAction/);
  assert.match(composer,/quickActions\.map/);
  assert.match(composer,/setMessage\(action\.prompt\)/);
  assert.match(composer,/textareaRef\.current\?\.focus\(\)/);
  assert.match(composer,/const unavailable = Boolean\(action\.needsWorkers && !scienceReady\)/);
  assert.match(composer,/disabled=\{unavailable \|\| sending\}/);
  assert.match(composer,/scienceReady = false/);
  assert.match(composer,/void send\(\)/);
  assert.match(composer,/onDrop=/);
  assert.match(composer,/validateSequenceFile\(file\)/);
  assert.match(composer,/\/api\/v1\/storage\/sequence-uploads/);
  assert.doesNotMatch(composer,/mockResponse|fakeAnalysisResult|Math\.random\(\).*scientific/);
});

test("V32 new researcher can create their lab and project without leaving AI chat",()=>{
  assert.match(landing,/action=\{createAiResearchLab\}/);
  assert.match(landing,/action=\{createAiResearchProject\}/);
  assert.match(landing,/!labs\.length/);
  assert.match(landing,/activeProjects\.length/);
  assert.match(onboarding,/supabase\.auth\.getClaims\(\)/);
  assert.match(onboarding,/supabase\.rpc\("create_organization"/);
  assert.match(onboarding,/supabase\.from\("projects"\)\.insert/);
  assert.match(onboarding,/created_by: userId/);
  assert.match(onboarding,/revalidatePath\("\/dashboard\/ai"\)/);
  assert.match(onboarding,/redirect\("\/dashboard\/ai"\)/);
  assert.doesNotMatch(onboarding,/createServiceClient|SUPABASE_SECRET_KEY|service_role/);
});

test("V32 searchable RLS-scoped chat history and shared navigation appear on both chat routes",()=>{
  assert.match(sidebar,/useState\(""\)/);
  assert.match(sidebar,/type="search"/);
  assert.match(sidebar,/conversations\.filter/);
  assert.match(sidebar,/usePathname/);
  assert.match(sidebar,/aria-current=\{pathname===href\?"page":undefined\}/);
  assert.match(sidebar,/Start a new conversation/);
  assert.match(sidebar,/<DashboardPrimaryNav/);
  assert.ok(navigation.includes('/dashboard/tools'));
  assert.ok(navigation.includes('/dashboard/dossiers'));
  assert.match(conversation,/navConversations/);
  assert.match(conversation,/from\("ai_conversations"\)/);
  assert.match(conversation,/from\("projects"\)/);
  assert.match(conversation,/ResearchChatSidebar/);
  assert.doesNotMatch(sidebar,/createServiceClient|SUPABASE_SECRET_KEY|NEXT_PUBLIC_SUPABASE_SECRET_KEY/);
});

test("V32 conversation keeps actual science consent and provenance accessible inside chat",()=>{
  assert.match(conversation,/action=\{approveChatResearchProtocol\}/);
  assert.match(conversation,/action=\{approveAiPlan\}/);
  assert.match(conversation,/ResearchActivityRefresh/);
  assert.match(conversation,/ResearchAvailabilityRefresh/);
  assert.match(conversation,/ConversationDossierPanel/);
  assert.match(conversation,/research_pipeline_run_id/);
  assert.match(conversation,/Verified in-chat protocol findings/);
  assert.match(conversation,/Download integrity-checked scientific result/);
  assert.match(conversation,/className=\{styles\.activityToggle\}/);
  assert.match(conversation,/activityPlans\.length > 0/);
  assert.match(conversation,/styles\.stickyComposer/);
  assert.match(conversation,/Genithm BioAI/);
  assert.doesNotMatch(conversation,/href="\/preview"/);
});

test("V32 design remains keyboard-, mobile-, and status-accessible",()=>{
  assert.match(composer,/onKeyDown/);
  assert.match(composer,/event\.key === "Enter" && !event\.shiftKey/);
  assert.match(composer,/aria-label="Attach research files or images"/);
  assert.match(sidebar,/aria-label="Search conversations"/);
  assert.match(sidebar,/aria-expanded=\{mobileOpen\}/);
  assert.match(landing,/role="status"/);
  assert.match(landing,/role="alert"/);
  for(const css of [landingStyle,conversationStyle,sidebarStyle,composerStyle]){
    assert.match(css,/@media\s*\(max-width:\s*\d+px\)/);
    assert.match(css,/var\(--g-/);
  }
});

test("V32 full navigation prioritizes chat without deleting advanced research tools",()=>{
  assert.match(navigation,/label:"AI Chat"/);
  assert.match(navigation,/label:"Tools"/);
  assert.match(navigation,/Research history/);
  assert.match(navigation,/<details className="genithm-more-nav"/);
  for(const href of ["/dashboard/pipelines","/dashboard/pipeline-studies","/dashboard/dossiers","/dashboard/billing","/dashboard/operations"]){assert.ok(navigation.includes(href),href);}
});

test("V32 real BioAI chat can start without a Docker fleet or sample-only workbench",()=>{
  assert.match(chatLauncher,/SUPABASE_SECRET_KEY GEMINI_API_KEY GROQ_API_KEY/);
  assert.match(chatLauncher,/NEXT_PUBLIC_SUPABASE_URL=https:\/\/vowmjjgkjoxcvlfamukh\.supabase\.co/);
  assert.match(chatLauncher,/GENITHM_SCIENCE_V22_ENABLED=false/);
  assert.match(chatLauncher,/GEMINI_API_KEY/);
  assert.match(chatLauncher,/chmod 600 "\$WEB_DIR\/\.env\.local"/);
  assert.match(chatLauncher,/npm run dev -- --hostname 0\.0\.0\.0 --port 3000/);
  assert.match(chatLauncher,/\/api\/health/);
  assert.match(chatLauncher,/Genithm BioAI chat web is running/);
  assert.match(chatLauncher,/Sign in: \$ORIGIN\/login/);
  assert.match(chatLauncher,/Scientific jobs, NCBI retrieval and FASTA uploads are not started/);
  assert.doesNotMatch(chatLauncher,/docker compose.*up|docker pull|\.devcontainer\/start\.sh/);
  assert.doesNotMatch(chatLauncher,/NEXT_PUBLIC_SUPABASE_SECRET_KEY|NEXT_PUBLIC_GEMINI_API_KEY/);
});
