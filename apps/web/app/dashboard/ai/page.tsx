import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { requestAiPlan } from "./actions";

export default async function AiWorkspacePage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const query = await searchParams;
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (!claimsData?.claims?.sub) redirect("/login");

  const [{ data: projects }, { data: conversations }, { data: interpretations }] = await Promise.all([
    supabase.from("projects").select("id,name,status,created_at").eq("status", "active").order("created_at", { ascending: false }).limit(100),
    supabase.from("ai_conversations").select("id,project_id,title,status,created_at,updated_at").order("updated_at", { ascending: false }).limit(50),
    supabase.from("ai_interpretation_requests")
      .select("id,conversation_id,project_id,resource_type,resource_id,evidence_sha256,created_at")
      .eq("status", "completed")
      .order("created_at", { ascending: false })
      .limit(20),
  ]);
  const projectName = new Map((projects ?? []).map((project) => [project.id, project.name]));

  return (
    <main className="container dashboard">
      <header className="dashboard-header">
        <div>
          <div className="eyebrow">Permission-controlled orchestration</div>
          <h2>Genithm AI</h2>
          <p className="small">Natural language becomes a validated scientific plan. The model cannot execute tools directly; nothing runs until you explicitly approve a ready plan.</p>
        </div>
        <div className="actions" style={{ marginTop: 0 }}>
          <Link className="button primary" href="/dashboard/ai/operations">Operational health</Link>
          <Link className="button" href="/dashboard">Back to dashboard</Link>
        </div>
      </header>

      {query.error ? <p className="error">{query.error}</p> : null}

      <section className="card">
        <div className="eyebrow">New plan</div>
        <h3>Describe one scientific action</h3>
        <p>V1 can plan one approved action at a time: NCBI retrieval, BLAST, Pairwise Alignment, MSA, phylogeny, protein properties, or evidence-backed protein annotation. Ambiguous or multi-step requests are returned as unsupported rather than guessed.</p>
        {(projects ?? []).length ? (
          <form action={requestAiPlan} className="stack" style={{ maxWidth: 760 }}>
            <label>
              Project
              <select className="select" name="project_id" required>
                {(projects ?? []).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
              </select>
            </label>
            <label>
              Scientific request
              <textarea name="user_message" minLength={1} maxLength={8000} required placeholder="Example: Run protein properties on the ready protein sequence in this project." />
            </label>
            <div className="notice">The planner sees only bounded, authorized project context. A proposed plan is revalidated by Genithm policy before it can become approvable, and it is validated again at approval time.</div>
            <button className="button primary">Create plan</button>
          </form>
        ) : <div className="notice">Create an active project before using Genithm AI.</div>}
      </section>

      <section className="card" style={{ marginTop: 18 }}>
        <div className="eyebrow">Evidence explorer</div>
        <h3>Recent verified-input interpretations</h3>
        <div className="notice">Inspect the exact frozen evidence snapshot supplied to the interpreter. The explorer recomputes the stored snapshot SHA-256 in the database before presenting values as verified.</div>
        <div className="list" style={{ marginTop: 12 }}>
          {(interpretations ?? []).map((interpretation) => (
            <div className="item" key={interpretation.id}>
              <div className="dashboard-header">
                <div>
                  <strong>{interpretation.resource_type.replaceAll("_", " ")}</strong>
                  <div className="small">{projectName.get(interpretation.project_id) ?? "Project"} · resource <code>{interpretation.resource_id}</code> · frozen {new Date(interpretation.created_at).toLocaleString()}</div>
                  <div className="small">Evidence SHA-256: <code>{interpretation.evidence_sha256}</code></div>
                </div>
                <div className="actions" style={{ marginTop: 0 }}>
                  <Link className="button primary" href={`/dashboard/ai/evidence/${interpretation.id}`}>Inspect frozen evidence</Link>
                  <Link className="button" href={`/dashboard/ai/${interpretation.conversation_id}`}>Conversation</Link>
                </div>
              </div>
            </div>
          ))}
          {!interpretations?.length ? <div className="notice">No completed evidence-grounded interpretations are available yet.</div> : null}
        </div>
      </section>

      <section className="card" style={{ marginTop: 18 }}>
        <div className="eyebrow">History</div>
        <h3>AI conversations</h3>
        <div className="list">
          {(conversations ?? []).map((conversation) => (
            <div className="item" key={conversation.id}>
              <div className="dashboard-header">
                <div>
                  <strong>{conversation.title}</strong>
                  <div className="small">{projectName.get(conversation.project_id) ?? "Project"} · {conversation.status} · updated {new Date(conversation.updated_at).toLocaleString()}</div>
                </div>
                <Link className="button" href={`/dashboard/ai/${conversation.id}`}>Open</Link>
              </div>
            </div>
          ))}
          {!conversations?.length ? <div className="notice">No AI planning conversations yet.</div> : null}
        </div>
      </section>
    </main>
  );
}