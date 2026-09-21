import Link from "next/link";
import { redirect } from "next/navigation";

import { AiChatComposer } from "@/components/ai-chat-composer";
import { createClient } from "@/lib/supabase/server";
import styles from "./chat.module.css";

const starterPrompts = [
  "Fetch an NCBI accession and help me analyze it.",
  "Run BLAST on one of my sequences and explain the strongest hits.",
  "Compare my sequences with an alignment and summarize the differences.",
  "Build a phylogenetic workflow from my available sequences.",
] as const;

export default async function AiWorkspacePage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const query = await searchParams;
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (!claimsData?.claims?.sub) redirect("/login");

  const [{ data: projects }, { data: conversations }] = await Promise.all([
    supabase.from("projects").select("id,name,status,created_at").eq("status", "active").order("created_at", { ascending: false }).limit(100),
    supabase.from("ai_conversations").select("id,project_id,title,status,created_at,updated_at").order("updated_at", { ascending: false }).limit(50),
  ]);

  const activeProjects = projects ?? [];
  const projectName = new Map(activeProjects.map((project) => [project.id, project.name]));

  return (
    <main className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.brandRow}>
          <div>
            <div className="eyebrow">Genithm</div>
            <strong>Bioinformatics AI</strong>
          </div>
          <Link className="button" href="/dashboard/tools">Advanced tools</Link>
        </div>

        <Link className={styles.newChat} href="/dashboard/ai">+ New chat</Link>

        <div className={styles.historyLabel}>Recent chats</div>
        <div className={styles.history}>
          {(conversations ?? []).map((conversation) => (
            <Link className={styles.historyItem} href={"/dashboard/ai/" + conversation.id} key={conversation.id}>
              <strong>{conversation.title}</strong>
              <span>{projectName.get(conversation.project_id) ?? "Project"}</span>
            </Link>
          ))}
          {!conversations?.length ? <div className={styles.emptyHistory}>Your research conversations will appear here.</div> : null}
        </div>

        <div className={styles.sidebarFooter}>
          <Link href="/dashboard/reports">Reports</Link>
          <Link href="/dashboard/billing">Plan & usage</Link>
        </div>
      </aside>

      <section className={styles.main}>
        <div className={styles.hero}>
          <div className="eyebrow">AI-native bioinformatics workspace</div>
          <h1>What do you want to do with your biological data?</h1>
          <p>
            Ask Genithm in normal language. It can plan scientific work using your authorized project data,
            dispatch supported bioinformatics tools, track execution, and explain recorded results.
          </p>
        </div>

        {query.error ? <div className={"error " + styles.feedback}>{query.error}</div> : null}

        {activeProjects.length ? (
          <AiChatComposer
            projects={activeProjects.map((project) => ({ id: project.id, name: project.name }))}
            defaultProjectId={activeProjects[0]?.id}
            placeholder="Message Genithm… ask a bioinformatics question, request an analysis, or attach FASTA files."
          />
        ) : (
          <div className={styles.noProject}>
            <h2>Create a project once, then work by chatting.</h2>
            <p>Projects provide the secure container for your sequences, analyses, provenance, and conversations.</p>
            <Link className="button primary" href="/dashboard/tools">Create project in Advanced tools</Link>
          </div>
        )}

        <div className={styles.starters}>
          {starterPrompts.map((prompt) => <div className={styles.starter} key={prompt}>{prompt}</div>)}
        </div>

        <div className={styles.capabilityNote}>
          <strong>Fast chat, controlled scientific execution</strong>
          <span>
            Normal conversation and planning respond directly. Only real scientific computations such as BLAST, alignments, and tree building use background workers.
          </span>
        </div>
      </section>
    </main>
  );
}
