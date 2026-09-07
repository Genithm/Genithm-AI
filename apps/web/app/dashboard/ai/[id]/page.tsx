import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { approveAiPlan, requestAiPlan } from "../actions";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function planParts(value: unknown) {
  if (!isRecord(value)) return { summary: null as string | null, limitations: [] as string[], action: null as Record<string, unknown> | null };
  return {
    summary: typeof value.summary === "string" ? value.summary : null,
    limitations: Array.isArray(value.limitations) ? value.limitations.filter((item): item is string => typeof item === "string") : [],
    action: isRecord(value.action) ? value.action : null,
  };
}

function dispatchedHref(resourceType: string | null, resourceId: string | null) {
  if (!resourceId) return null;
  if (resourceType === "scientific_job") return `/dashboard/scientific-jobs/${resourceId}`;
  if (resourceType === "protein_annotation_job") return `/dashboard/protein-annotations/${resourceId}`;
  return "/dashboard";
}

export default async function AiConversationPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const { id } = await params;
  const query = await searchParams;
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (!claimsData?.claims?.sub) redirect("/login");

  const { data: conversation, error } = await supabase.from("ai_conversations")
    .select("id,project_id,title,status,created_at,updated_at")
    .eq("id", id)
    .maybeSingle();
  if (error || !conversation) notFound();

  const [{ data: messages }, { data: plans }, { data: project }] = await Promise.all([
    supabase.from("ai_messages")
      .select("id,role,content,message_kind,plan_request_id,created_at")
      .eq("conversation_id", id)
      .order("created_at", { ascending: true })
      .limit(200),
    supabase.from("ai_plan_requests")
      .select("id,status,provider,model,prompt_version,policy_version,plan_schema_version,plan,plan_sha256,action_type,requires_confirmation,dispatched_resource_type,dispatched_resource_id,processing_attempts,processing_started_at,processing_finished_at,processing_error,created_at")
      .eq("conversation_id", id)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase.from("projects").select("id,name,status").eq("id", conversation.project_id).maybeSingle(),
  ]);

  return (
    <main className="container dashboard">
      <header className="dashboard-header">
        <div>
          <div className="eyebrow">Genithm AI conversation</div>
          <h2>{conversation.title}</h2>
          <p className="small">{project?.name ?? "Project"} · conversation {conversation.id}</p>
        </div>
        <div className="actions" style={{ marginTop: 0 }}>
          <Link className="button" href="/dashboard/ai">AI workspace</Link>
          <Link className="button" href="/dashboard">Dashboard</Link>
        </div>
      </header>

      {query.error ? <p className="error">{query.error}</p> : null}

      <section className="card">
        <div className="eyebrow">Continue</div>
        <h3>Ask for another single scientific action</h3>
        <form action={requestAiPlan} className="stack">
          <input type="hidden" name="project_id" value={conversation.project_id} />
          <input type="hidden" name="conversation_id" value={conversation.id} />
          <label>
            Request
            <textarea name="user_message" minLength={1} maxLength={8000} required placeholder="Describe the next scientific action. The planner will not execute it automatically." />
          </label>
          <button className="button primary">Create plan</button>
        </form>
        <div className="notice" style={{ marginTop: 14 }}>Conversation history is supplied to the planner only as bounded untrusted data. Previous assistant text cannot grant permissions or bypass the execution policy.</div>
      </section>

      <section className="card" style={{ marginTop: 18 }}>
        <div className="eyebrow">Planning lifecycle</div>
        <h3>Plans</h3>
        <div className="list">
          {(plans ?? []).map((plan) => {
            const parsed = planParts(plan.plan);
            const action = parsed.action;
            const parameters = action && isRecord(action.parameters) ? action.parameters : null;
            const href = dispatchedHref(plan.dispatched_resource_type, plan.dispatched_resource_id);
            return (
              <div className="item" key={plan.id}>
                <div className="dashboard-header">
                  <div>
                    <strong>{plan.action_type ? plan.action_type.replaceAll("_", " ") : plan.status.replaceAll("_", " ")}</strong>
                    <div className="small">Status: {plan.status} · attempts {plan.processing_attempts} · created {new Date(plan.created_at).toLocaleString()}</div>
                  </div>
                  {plan.status === "ready" && plan.requires_confirmation ? (
                    <form action={approveAiPlan}>
                      <input type="hidden" name="plan_request_id" value={plan.id} />
                      <input type="hidden" name="conversation_id" value={conversation.id} />
                      <button className="button primary">Approve &amp; run</button>
                    </form>
                  ) : null}
                  {plan.status === "dispatched" && href ? <Link className="button primary" href={href}>Open dispatched work</Link> : null}
                </div>

                {parsed.summary ? <p>{parsed.summary}</p> : null}
                {parsed.limitations.length ? <div className="notice"><strong>Limitations</strong><div className="small">{parsed.limitations.join(" · ")}</div></div> : null}
                {parameters ? <details style={{ marginTop: 12 }}><summary>Planned parameters</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify(parameters, null, 2)}</pre></details> : null}
                {plan.plan_sha256 ? <div className="small">Plan SHA-256: <code>{plan.plan_sha256}</code></div> : null}
                {plan.provider || plan.model ? <div className="small">Planner: {plan.provider ?? "unknown"}/{plan.model ?? "unknown"}{plan.prompt_version ? ` · prompt ${plan.prompt_version}` : ""} · policy {plan.policy_version}</div> : <div className="small">Policy: {plan.policy_version}</div>}
                {plan.processing_error ? <div className="error">Planning error: {plan.processing_error}</div> : null}
                {plan.status === "ready" ? <div className="notice" style={{ marginTop: 12 }}>Approval does not trust the model output directly. Genithm revalidates the action, current project authorization, referenced resource IDs, and tool-specific constraints before dispatch.</div> : null}
              </div>
            );
          })}
          {!plans?.length ? <div className="notice">No plans have been created in this conversation yet.</div> : null}
        </div>
      </section>

      <section className="card" style={{ marginTop: 18 }}>
        <div className="eyebrow">Conversation record</div>
        <h3>Messages</h3>
        <div className="list">
          {(messages ?? []).map((message) => (
            <div className="item" key={message.id}>
              <strong>{message.role === "user" ? "You" : "Genithm AI"}</strong>
              <div className="small">{message.message_kind.replaceAll("_", " ")} · {new Date(message.created_at).toLocaleString()}</div>
              <p style={{ whiteSpace: "pre-wrap" }}>{message.content}</p>
            </div>
          ))}
          {!messages?.length ? <div className="notice">No messages yet.</div> : null}
        </div>
      </section>
    </main>
  );
}
