import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AiChatComposer } from "@/components/ai-chat-composer";
import { createClient } from "@/lib/supabase/server";
import { approveAiPlan, requestAiInterpretation } from "../actions";
import { ConversationProgressRefresh } from "./conversation-progress-refresh";
import styles from "./conversation.module.css";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readable(value: string | null | undefined) {
  return (value ?? "unknown").replaceAll("_", " ");
}

function planSummary(value: unknown) {
  if (!isRecord(value)) return null;
  return typeof value.summary === "string" ? value.summary : null;
}

function interpretationSummary(value: unknown) {
  if (!isRecord(value)) return null;
  return typeof value.summary === "string" ? value.summary : null;
}

const SCIENTIFIC_METRICS: Record<string, string[]> = {
  pairwise_alignment: ["score", "identity_percent", "aligned_length", "matches", "mismatches", "gaps"],
  multiple_sequence_alignment: ["sequence_count", "aligned_length", "strategy"],
  phylogenetic_tree: ["leaf_count", "model", "internal_support_count"],
  sequence_insights: ["operation", "sequence_type", "sequence_length", "orf_count", "reported_orfs", "frame_count", "motif_hits"],
  protein_properties: ["sequence_length", "molecular_weight_da", "isoelectric_point", "gravy", "instability_index"],
};

function recordedMetrics(jobType: string, summary: unknown): Array<{ label: string; value: string }> {
  if (!isRecord(summary)) return [];
  return (SCIENTIFIC_METRICS[jobType] ?? [])
    .filter((key) => typeof summary[key] === "number" || typeof summary[key] === "string")
    .slice(0, 6)
    .map((key) => ({
      label: key.replaceAll("_", " "),
      value: String(summary[key]).slice(0, 100),
    }));
}

function resultHref(resourceType: string | null, resourceId: string | null) {
  if (!resourceId) return null;
  if (resourceType === "scientific_job") return `/dashboard/scientific-jobs/${resourceId}`;
  if (resourceType === "protein_annotation_job") return `/dashboard/protein-annotations/${resourceId}`;
  return null;
}

function isInterpretationEligible(resourceType: string | null, status: string | null) {
  if (!resourceType || !status) return false;
  if (resourceType === "scientific_job" || resourceType === "blast_job") return status === "completed";
  if (resourceType === "protein_annotation_job") return status === "completed" || status === "no_mapping";
  if (resourceType === "sequence_retrieval") return status === "retrieved" || status === "not_found";
  return false;
}

export default async function AiConversationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (!claimsData?.claims?.sub) redirect("/login");

  const { data: conversation } = await supabase
    .from("ai_conversations")
    .select("id,project_id,title,status,created_at,updated_at")
    .eq("id", id)
    .maybeSingle();

  if (!conversation) notFound();

  const [{ data: project }, { data: messages }, { data: plans }, { data: interpretations }] = await Promise.all([
    supabase.from("projects").select("id,name,status").eq("id", conversation.project_id).maybeSingle(),
    supabase
      .from("ai_messages")
      .select("id,role,content,message_kind,plan_request_id,attachment_upload_ids,created_at")
      .eq("conversation_id", id)
      .order("created_at", { ascending: true })
      .limit(250),
    supabase
      .from("ai_plan_requests")
      .select("id,status,plan,action_type,requires_confirmation,dispatched_resource_type,dispatched_resource_id,processing_error,attachment_upload_ids,created_at,updated_at")
      .eq("conversation_id", id)
      .order("created_at", { ascending: true })
      .limit(100),
    supabase
      .from("ai_interpretation_requests")
      .select("id,plan_request_id,status,interpretation,processing_error,created_at")
      .eq("conversation_id", id)
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  const attachmentIds = [...new Set([...(plans ?? []).flatMap((plan) => plan.attachment_upload_ids ?? []), ...(messages ?? []).flatMap((message) => message.attachment_upload_ids ?? [])])];
  const { data: attachmentRows } = attachmentIds.length
    ? await supabase.from("sequence_uploads").select("id,original_filename,status").in("id", attachmentIds)
    : { data: [] as Array<{ id: string; original_filename: string; status: string }> };

  const attachmentById = new Map((attachmentRows ?? []).map((row) => [row.id, row]));
  const attachmentsByPlan = new Map<string, Array<{ id: string; original_filename: string; status: string }>>();
  const attachmentsByMessage = new Map<string, Array<{ id: string; original_filename: string; status: string }>>();
  for (const plan of plans ?? []) {
    const rows = (plan.attachment_upload_ids ?? [])
      .map((attachmentId) => attachmentById.get(attachmentId))
      .filter((row): row is { id: string; original_filename: string; status: string } => Boolean(row));
    if (rows.length) attachmentsByPlan.set(plan.id, rows);
  }
  for (const message of messages ?? []) {
    const rows = (message.attachment_upload_ids ?? [])
      .map((attachmentId) => attachmentById.get(attachmentId))
      .filter((row): row is { id: string; original_filename: string; status: string } => Boolean(row));
    if (rows.length) attachmentsByMessage.set(message.id, rows);
  }

  const dispatched = (plans ?? []).filter(
    (plan) => plan.dispatched_resource_type && plan.dispatched_resource_id,
  );
  const scientificIds = dispatched
    .filter((plan) => plan.dispatched_resource_type === "scientific_job")
    .map((plan) => plan.dispatched_resource_id as string);
  const annotationIds = dispatched
    .filter((plan) => plan.dispatched_resource_type === "protein_annotation_job")
    .map((plan) => plan.dispatched_resource_id as string);
  const retrievalIds = dispatched
    .filter((plan) => plan.dispatched_resource_type === "sequence_retrieval")
    .map((plan) => plan.dispatched_resource_id as string);
  const blastIds = dispatched
    .filter((plan) => plan.dispatched_resource_type === "blast_job")
    .map((plan) => plan.dispatched_resource_id as string);
  const workflowIds = dispatched
    .filter((plan) => plan.dispatched_resource_type === "ai_workflow")
    .map((plan) => plan.dispatched_resource_id as string);

  const [scientific, annotations, retrievals, blasts, workflows] = await Promise.all([
    scientificIds.length
      ? supabase.from("scientific_jobs").select("id,status,job_type,processing_error,updated_at,result_summary,result_sha256,result_object_path").in("id", scientificIds)
      : Promise.resolve({ data: [] }),
    annotationIds.length
      ? supabase.from("protein_annotation_jobs").select("id,status,processing_error,updated_at").in("id", annotationIds)
      : Promise.resolve({ data: [] }),
    retrievalIds.length
      ? supabase.from("sequence_retrievals").select("id,status,processing_error,updated_at").in("id", retrievalIds)
      : Promise.resolve({ data: [] }),
    blastIds.length
      ? supabase.from("blast_jobs").select("id,status,processing_error,updated_at").in("id", blastIds)
      : Promise.resolve({ data: [] }),
    workflowIds.length
      ? supabase.from("ai_workflow_runs").select("id,status,processing_error,msa_job_id,phylogeny_job_id,updated_at").in("id", workflowIds)
      : Promise.resolve({ data: [] }),
  ]);

  const execution = new Map<string, { status: string; error: string | null; updated_at: string }>();
  for (const row of scientific.data ?? []) execution.set(`scientific_job:${row.id}`, { status: row.status, error: row.processing_error, updated_at: row.updated_at });
  for (const row of annotations.data ?? []) execution.set(`protein_annotation_job:${row.id}`, { status: row.status, error: row.processing_error, updated_at: row.updated_at });
  for (const row of retrievals.data ?? []) execution.set(`sequence_retrieval:${row.id}`, { status: row.status, error: row.processing_error, updated_at: row.updated_at });
  for (const row of blasts.data ?? []) execution.set(`blast_job:${row.id}`, { status: row.status, error: row.processing_error, updated_at: row.updated_at });
  for (const row of workflows.data ?? []) execution.set(`ai_workflow:${row.id}`, { status: row.status, error: row.processing_error, updated_at: row.updated_at });
  const workflowById = new Map((workflows.data ?? []).map((row) => [row.id, row]));
  const scientificById = new Map((scientific.data ?? []).map((row) => [row.id, row]));

  const activityPlans = (plans ?? []).filter((plan) =>
    ["ready", "dispatched"].includes(plan.status) || (plan.status === "error" && Boolean(plan.action_type)),
  );

  const interpretationByPlan = new Map<string, NonNullable<typeof interpretations>[number]>();
  for (const item of interpretations ?? []) {
    if (!interpretationByPlan.has(item.plan_request_id)) interpretationByPlan.set(item.plan_request_id, item);
  }

  return (
    <main className={styles.shell}>
      <aside className={styles.sidebar}>
        <Link className={styles.back} href="/dashboard/ai">← Chats</Link>
        <div className={styles.projectBlock}>
          <div className="eyebrow">Project</div>
          <strong>{project?.name ?? "Research project"}</strong>
        </div>
        <Link href="/dashboard/tools">Advanced tools</Link>
        <Link href="/dashboard/reports">Reports</Link>
      </aside>

      <section className={styles.main}>
        <header className={styles.header}>
          <div>
            <div className="eyebrow">Genithm chat</div>
            <h1>{conversation.title}</h1>
          </div>
          <Link className="button" href={`/dashboard/ai/${conversation.id}`}>Refresh</Link>
        </header>

        {query.error ? <div className="error">{query.error}</div> : null}

        <div className={styles.thread} aria-live="polite">
          {(messages ?? []).map((message) => (
            <article
              className={message.role === "user" ? styles.userMessage : styles.assistantMessage}
              key={message.id}
            >
              <div className={styles.messageMeta}>
                {message.role === "user" ? "You" : "Genithm"}
              </div>
              <div className={styles.messageBody}>{message.content}</div>
              {(attachmentsByMessage.get(message.id)?.length || (message.plan_request_id && attachmentsByPlan.get(message.plan_request_id)?.length)) ? (
                <div className={styles.messageAttachments}>
                  {(attachmentsByMessage.get(message.id) ?? (message.plan_request_id ? attachmentsByPlan.get(message.plan_request_id) : undefined) ?? []).map((attachment) => (
                    <span key={attachment.id}>
                      <strong>{attachment.original_filename}</strong>
                      <small>{readable(attachment.status)}</small>
                    </span>
                  ))}
                </div>
              ) : null}
            </article>
          ))}
          {!messages?.length ? (
            <div className={styles.empty}>Ask Genithm what you want to do with your biological data.</div>
          ) : null}
        </div>

        <section className={styles.activity} aria-label="Research results and approvals">
          <div className={styles.activityTitle}>
            <strong>Research activity · scientific results in this chat</strong>
            <span>Approvals, live progress, measured results and evidence-grounded explanations</span>
          </div>
          <div className={styles.activityList}>
            {activityPlans.map((plan) => {
              const resourceKey =
                plan.dispatched_resource_type && plan.dispatched_resource_id
                  ? `${plan.dispatched_resource_type}:${plan.dispatched_resource_id}`
                  : null;
              const state = resourceKey ? execution.get(resourceKey) : null;
              const workflow = plan.dispatched_resource_type === "ai_workflow" && plan.dispatched_resource_id
                ? workflowById.get(plan.dispatched_resource_id)
                : null;
              const href = workflow
                ? "/dashboard/workflows/" + workflow.id
                : resultHref(plan.dispatched_resource_type, plan.dispatched_resource_id);
              const interpretation = interpretationByPlan.get(plan.id);
              const scientificResult = plan.dispatched_resource_type === "scientific_job" && plan.dispatched_resource_id
                ? scientificById.get(plan.dispatched_resource_id)
                : null;
              const metrics = scientificResult?.status === "completed"
                ? recordedMetrics(scientificResult.job_type, scientificResult.result_summary)
                : [];

              return (
                <article className={styles.activityCard} key={plan.id}>
                  <div className={styles.activityHeader}>
                    <div>
                      <strong>{plan.action_type ? readable(plan.action_type) : readable(plan.status)}</strong>
                      <div className={styles.muted}>
                        Plan {readable(plan.status)}
                        {state ? ` · execution ${readable(state.status)}` : ""}
                        {workflow ? ` · MSA ${workflow.msa_job_id.slice(0, 8)}${workflow.phylogeny_job_id ? ` · tree ${workflow.phylogeny_job_id.slice(0, 8)}` : " · tree pending"}` : ""}
                      </div>
                    </div>
                    <div className={styles.actions}>
                      {plan.status === "ready" && plan.requires_confirmation ? (
                        <form action={approveAiPlan}>
                          <input type="hidden" name="plan_request_id" value={plan.id} />
                          <input type="hidden" name="conversation_id" value={conversation.id} />
                          <button className="button primary" type="submit">Approve & run</button>
                        </form>
                      ) : null}
                      {href ? <Link className="button" href={href}>{workflow ? "Full workflow evidence" : "Detailed result evidence"}</Link> : null}
                      {plan.status === "dispatched" &&
                      state &&
                      isInterpretationEligible(plan.dispatched_resource_type, state.status) &&
                      !interpretation ? (
                        <form action={requestAiInterpretation}>
                          <input type="hidden" name="plan_request_id" value={plan.id} />
                          <input type="hidden" name="conversation_id" value={conversation.id} />
                          <button className="button" type="submit">Explain result</button>
                        </form>
                      ) : null}
                    </div>
                  </div>

                  {planSummary(plan.plan) ? <p>{planSummary(plan.plan)}</p> : null}
                  {plan.status === "ready" && plan.requires_confirmation ? (
                    <p className={styles.consentNote}>This analysis requires your approval before computing. You can review its scope here without navigating to another page.</p>
                  ) : null}
                  {state && !["completed", "retrieved", "not_found", "no_mapping", "error", "failed", "cancelled"].includes(state.status) ? (
                    <p className={styles.running} role="status">Scientific work is {readable(state.status)}. This conversation refreshes its status automatically.</p>
                  ) : null}
                  {scientificResult?.status === "completed" && scientificResult.result_sha256 ? (
                    <div className={styles.measured}>
                      <strong>Recorded scientific findings</strong>
                      {metrics.length ? (
                        <dl className={styles.metricGrid}>
                          {metrics.map((metric) => <div key={metric.label}><dt>{metric.label}</dt><dd>{metric.value}</dd></div>)}
                        </dl>
                      ) : <p>Completed scientific result recorded. Use the verified evidence link for its full data.</p>}
                      <small>Result SHA-256: {scientificResult.result_sha256}</small>
                      {scientificResult.result_object_path && plan.dispatched_resource_id ? (
                        <a className="button" href={"/dashboard/scientific-jobs/" + plan.dispatched_resource_id + "/download"}>Download verified scientific output</a>
                      ) : null}
                    </div>
                  ) : null}
                  {state?.error ? <div className="error">{state.error}</div> : null}
                  {plan.processing_error ? <div className="error">{plan.processing_error}</div> : null}
                  {interpretation?.processing_error ? <div className="error">{interpretation.processing_error}</div> : null}
                  {interpretation?.status === "completed" && interpretationSummary(interpretation.interpretation) ? (
                    <div className={styles.interpretation}>
                      <strong>Genithm interpretation</strong>
                      <p>{interpretationSummary(interpretation.interpretation)}</p>
                    </div>
                  ) : null}
                </article>
              );
            })}
            {!activityPlans.length ? <div className={styles.empty}>No scientific activity yet.</div> : null}
          </div>
        </section>

        <ConversationProgressRefresh active={(plans ?? []).some((plan) => ["pending", "processing", "ready"].includes(plan.status)) || (plans ?? []).some((plan) => plan.status === "dispatched" && (() => { const state = plan.dispatched_resource_type && plan.dispatched_resource_id ? execution.get(plan.dispatched_resource_type + ":" + plan.dispatched_resource_id) : null; return !state || !["completed", "error", "failed", "cancelled", "not_found", "no_mapping", "retrieved"].includes(state.status); })()) || (interpretations ?? []).some((item) => !["completed", "error", "failed"].includes(item.status))} />
        <AiChatComposer
          key={`${conversation.id}:${messages?.length ?? 0}`}
          projects={[{ id: conversation.project_id, name: project?.name ?? "Research project" }]}
          conversationId={conversation.id}
          defaultProjectId={conversation.project_id}
          placeholder="Ask a follow-up, supply missing data or attach FASTA here…"
        />
      </section>
    </main>
  );
}
