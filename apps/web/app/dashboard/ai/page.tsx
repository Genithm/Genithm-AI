import Link from "next/link";
import { redirect } from "next/navigation";

import { AiChatComposer, type ResearchQuickAction } from "@/components/ai-chat-composer";
import { ResearchChatSidebar } from "@/components/research-chat-sidebar";
import { GenithmToolDock } from "@/components/genithm-tool-dock";
import "@/components/genithm-research-theme.css";
import { createClient } from "@/lib/supabase/server";
import { scienceExecutionReady } from "@/lib/science-execution-readiness";
import { scienceV22Configured } from "@/lib/science-release";
import { createAiResearchLab, createAiResearchProject } from "./onboarding-actions";
import styles from "./chat.module.css";

const researchActions: ResearchQuickAction[] = [
  {
    icon: "⌘", label: "DNA & RNA", detail: "Find open reading frames from an NCBI reference",
    prompt: "Run ORF scan on NM_000546.6", needsWorkers: true,
  },
  {
    icon: "◈", label: "Proteins", detail: "Calculate molecular properties of a protein",
    prompt: "Calculate protein properties for NP_000537.3", needsWorkers: true,
  },
  {
    icon: "⇄", label: "Sequence alignment", detail: "Compare FASTA sequences and interpret differences",
    prompt: "Help me align two sequences from my research project and interpret the important differences.",
  },
  {
    icon: "◎", label: "BLAST search", detail: "Find homologs and evaluate sequence similarities",
    prompt: "I want to run BLAST on a FASTA sequence. Guide me through a scientific search and explain the resulting hits.",
  },
  {
    icon: "♧", label: "Phylogenetics", detail: "From multiple alignment to evolutionary tree",
    prompt: "Plan a multiple sequence alignment and a phylogenetic tree for my sequences.",
  },
  {
    icon: "✳", label: "Ask Genithm", detail: "Explore methods, workflows, and biological questions",
    prompt: "Help me design a rigorous, reproducible bioinformatics workflow for my biological research question.",
  },
];

export default async function AiWorkspacePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const query = await searchParams;
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) redirect("/login");

  // Authenticated, RLS-scoped queries: never fetch another researcher's chats.
  const [{data: projects}, {data: conversations}, {data: organizations}] = await Promise.all([
    supabase.from("projects").select("id,name,status,created_at")
      .eq("status", "active").order("created_at",{ascending:false}).limit(100),
    supabase.from("ai_conversations")
      .select("id,project_id,title,status,created_at,updated_at")
      .order("updated_at",{ascending:false}).limit(50),
    supabase.from("organizations").select("id,name").order("created_at",{ascending:true}).limit(50),
  ]);

  const activeProjects = projects ?? [];
  const labs = organizations ?? [];
  const projectNames = Object.fromEntries(activeProjects.map((project) => [project.id, project.name]));

  const configured = scienceV22Configured();
  const fixedScienceReady = configured && await scienceExecutionReady();

  return (
    <main className={styles.shell} aria-label="Genithm AI research chat">
      <ResearchChatSidebar
        conversations={conversations ?? []}
        projectNames={projectNames}
        projectCount={activeProjects.length}
      />

      <section className={styles.main}>
        <div className={styles.topBar}>
          <div className={styles.workspaceIdentity}>
            <span className={styles.workspaceSymbol} aria-hidden="true">⌘</span>
            <span><strong>Genithm</strong> <span> / Bioinformatics workspace</span></span>
            <span className={styles.beta}>Research workspace</span>
          </div>
          <Link href="/dashboard/ai/research" className={styles.topLink}>View research history <span aria-hidden="true">↗</span></Link>
        </div>

        <div className={styles.content}>
          <div className={styles.hero}>
            <div className={styles.heroSymbol} aria-hidden="true">⌘</div>
            <div className={styles.heroEyebrow}>YOUR BIOINFORMATICS RESEARCH ASSISTANT</div>
            <h1>What would you like to analyze?</h1>
            <p>Describe a research task, upload your sequences, or explore biological data.
              Genithm connects scientific reasoning with reproducible computational tools.</p>
          </div>

          {query.error ? <div className={"error " + styles.feedback} role="alert">{query.error}</div> : null}

          {activeProjects.length ? (
            <>
              <AiChatComposer
                projects={activeProjects.map((project) => ({id:project.id,name:project.name}))}
                defaultProjectId={activeProjects[0]?.id}
                placeholder="Ask about biology, paste an NCBI accession, or describe your analysis…"
                quickActions={researchActions}
                scienceReady={fixedScienceReady}
              />
              {!fixedScienceReady ? (
                <div className={styles.availability} role="status">
                  <span className={styles.availabilityDot} aria-hidden="true" />
                  <div><strong>Scientific execution is currently unavailable</strong>
                    <span>You can still chat and plan. New fixed NCBI computations need healthy background workers and explicit approval.</span></div>
                </div>
              ) : (
                <div className={styles.availability} role="status">
                  <span className={styles.readyDot} aria-hidden="true" />
                  <div><strong>Scientific workers available</strong>
                    <span>Fixed NCBI workflows require your approval before retrieval or calculation begins.</span></div>
                </div>
              )}
            </>
          ) : (
            <div className={styles.onboarding}>
              <div className={styles.onboardingIntro}>
                <span className={styles.stepPill}>ONE-TIME SETUP</span>
                <h2>Start a research workspace</h2>
                <p>Like starting a new AI chat—your project keeps sequences, calculations and evidence together.
                   You can create your first lab and project here without visiting a separate admin dashboard.</p>
              </div>
              {!labs.length ? (
                <form action={createAiResearchLab} className={styles.setupForm}>
                  <label htmlFor="genithm-lab">Lab or research team name</label>
                  <div className={styles.setupRow}>
                    <input id="genithm-lab" name="name" minLength={2} maxLength={100}
                      placeholder="My research lab" autoComplete="organization" required />
                    <button className="button primary" type="submit">Create lab →</button>
                  </div>
                </form>
              ) : (
                <form action={createAiResearchProject} className={styles.setupForm}>
                  <label htmlFor="genithm-org">Research team</label>
                  <select id="genithm-org" name="organization_id" required>
                    {labs.map((lab) => <option key={lab.id} value={lab.id}>{lab.name}</option>)}
                  </select>
                  <label htmlFor="genithm-project">Project name</label>
                  <div className={styles.setupRow}>
                    <input id="genithm-project" name="name" minLength={2} maxLength={160}
                      placeholder="My first bioinformatics study" required />
                    <button className="button primary" type="submit">Create project →</button>
                  </div>
                </form>
              )}
              <p className={styles.setupFoot}>You control which research actions are approved. Your project data remains access-scoped.</p>
            </div>
          )}

          <div className={styles.bottomCaption}>Genithm can make mistakes. Review AI explanations and check recorded scientific evidence before drawing conclusions.</div>
        </div>
      </section>
      <GenithmToolDock projectCount={activeProjects.length} scienceReady={fixedScienceReady} />
    </main>
  );
}
