import Link from "next/link";
import { redirect } from "next/navigation";

import { AiChatComposer } from "@/components/ai-chat-composer";
import { createClient } from "@/lib/supabase/server";
import { startChatWorkspace } from "./actions";
import styles from "./chat.module.css";

const starterPrompts = [
  "Find the human TP53 nucleotide reference in NCBI and explain what I can analyze.",
  "I attached a sequence. Run BLAST and explain the strongest hits.",
  "Compare my uploaded sequences and summarize the differences.",
  "Build an MSA and phylogenetic tree from my sequences.",
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
          <Link href="/dashboard/research-journey">Research journey</Link>
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
            <div className="eyebrow">Genithm</div>
            <h2>Ready to research together?</h2>
            <p>I can set up your private research space here in chat. You will be able to attach FASTA files, ask for NCBI retrieval and receive scientific results in the conversation. No workflow configuration is required.</p>
            <form action={startChatWorkspace}>
              <button className="button primary" type="submit">Start my research chat</button>
            </form>
            <p className={styles.workspaceConsent}>Creates one private organization if needed and an active research project. Does not start scientific computing, incur charges or upload data.</p>
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
