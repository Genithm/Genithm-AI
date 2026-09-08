import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { approveAiPlan, requestAiInterpretation, requestAiPlan } from "../actions";

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

function interpretationParts(value: unknown) {
  if (!isRecord(value)) return { summary: null as string | null, findings: [] as Array<{ statement: string; evidenceIds: string[] }>, limitations: [] as string[] };
  const findings = Array.isArray(value.findings)
    ? value.findings.flatMap((item) => {
        if (!isRecord(item) || typeof item.statement !== "string" || !Array.isArray(item.evidence_ids)) return [];
        const evidenceIds = item.evidence_ids.filter((evidenceId): evidenceId is string => typeof evidenceId === "string");
        return [{ statement: item.statement, evidenceIds }];
      })
    : [];
  return {
    summary: typeof value.summary === "string" ? value.summary : null,
    findings,
    limitations: Array.isArray(value.limitations) ? value.limitations.filter((item): item is string => typeof item === "string") : [],
  };
}

function dispatchedHref(resourceType: string | null, resourceId: string | null) {
  if (!resourceId) return null;
  if (resourceType === "scientific_job") return `/dashboard/scientific-jobs/${resourceId}`;
  if (resourceType === "protein_annotation_job") return `/dashboard/protein-annotations/${resourceId}`;
  return null;
}

function resourceKey(resourceType: string, resourceId: string) {
  return `${resourceType}:${resourceId}`;
}

function readable(value: string) {
  return value.replaceAll("_", " ");
}

function canInterpret(resourceType: string | null, status: string | null) {
  if (!resourceType || !status) return false;
  if (resourceType === "scientific_job" || resourceType === "blast_job") return status === "completed";
  if (resourceType === "protein_annotation_job") return status === "completed" || status === "no_mapping";
  if (resourceType === "sequence_retrieval") return status === "retrieved" || status === "not_found";
  return false;
}

type ExecutionState = {
  status: string;
  updatedAt: string;
  label: string;
  error: string | null;
  summary: unknown | null;
  provenance: string[];
};

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

  const [{ data: messages }, { data: plans }, { data: interpretations }, { data: project }] = await Promise.all([
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
    supabase.from("ai_interpretation_requests")
      .select("id,plan_request_id,status,evidence_schema_version,evidence_sha256,provider,model,prompt_version,policy_version,interpretation_schema_version,interpretation,interpretation_sha256,processing_attempts,processing_error,created_at,updated_at")
      .eq("conversation_id", id)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase.from("projects").select("id,name,status").eq("id", conversation.project_id).maybeSingle(),
  ]);

  const interpretationByPlan = new Map((interpretations ?? []).map((item) => [item.plan_request_id, item]));
  const dispatched = (plans ?? []).filter((plan) => plan.status === "dispatched" && plan.dispatched_resource_type && plan.dispatched_resource_id);
  const scientificIds = dispatched.filter((plan) => plan.dispatched_resource_type === "scientific_job").map((plan) => plan.dispatched_resource_id as string);
  const annotationIds = dispatched.filter((plan) => plan.dispatched_resource_type === "protein_annotation_job").map((plan) => plan.dispatched_resource_id as string);
  const retrievalIds = dispatched.filter((plan) => plan.dispatched_resource_type === "sequence_retrieval").map((plan) => plan.dispatched_resource_id as string);
  const blastIds = dispatched.filter((plan) => plan.dispatched_resource_type === "blast_job").map((plan) => plan.dispatched_resource_id as string);

  const loadScientificStates = async () => {
    if (!scientificIds.length) return [];
    const { data } = await supabase.from("scientific_jobs")
      .select("id,status,job_type,tool_id,tool_version,executor_version,result_sha256,result_summary,provenance,failure_class,processing_error,updated_at")
      .in("id", scientificIds);
    return data ?? [];
  };
  const loadAnnotationStates = async () => {
    if (!annotationIds.length) return [];
    const { data } = await supabase.from("protein_annotation_jobs")
      .select("id,status,refseq_accession,uniprot_accession,uniprot_reviewed,protein_name,organism_name,connector_version,source_checked_at,annotation_summary,processing_error,updated_at")
      .in("id", annotationIds);
    return data ?? [];
  };
  const loadRetrievalStates = async () => {
    if (!retrievalIds.length) return [];
    const { data } = await supabase.from("sequence_retrievals")
      .select("id,status,source_provider,source_database,requested_accession,resolved_accession,record_title,organism,connector_version,source_checked_at,source_retrieved_at,source_response_sha256,result_message,processing_error,updated_at")
      .in("id", retrievalIds);
    return data ?? [];
  };
  const loadBlastStates = async () => {
    if (!blastIds.length) return [];
    const { data } = await supabase.from("blast_jobs")
      .select("id,status,program,database_name,service_provider,service_mode,service_version,blast_version,database_release,result_summary,raw_result_sha256,processing_error,updated_at")
      .in("id", blastIds);
    return data ?? [];
  };

  const [scientificStates, annotationStates, retrievalStates, blastStates] = await Promise.all([
    loadScientificStates(),
    loadAnnotationStates(),
    loadRetrievalStates(),
    loadBlastStates(),
  ]);

  const executionByResource = new Map<string, ExecutionState>();
  for (const state of scientificStates) {
    executionByResource.set(resourceKey("scientific_job", state.id), {
      status: state.status,
      updatedAt: state.updated_at,
      label: `${readable(state.job_type)} · ${state.tool_id}/${state.tool_version}`,
      error: state.processing_error,
      summary: state.result_summary,
      provenance: [
        state.executor_version ? `Executor ${state.executor_version}` : null,
        state.result_sha256 ? `Result SHA-256 ${state.result_sha256}` : null,
        state.failure_class ? `Failure class ${readable(state.failure_class)}` : null,
        state.provenance ? "Structured execution provenance recorded" : null,
      ].filter((item): item is string => Boolean(item)),
    });
  }
  for (const state of annotationStates) {
    executionByResource.set(resourceKey("protein_annotation_job", state.id), {
      status: state.status,
      updatedAt: state.updated_at,
      label: `protein annotation evidence · RefSeq ${state.refseq_accession}`,
      error: state.processing_error,
      summary: state.annotation_summary,
      provenance: [
        state.protein_name ? `Protein ${state.protein_name}` : null,
        state.organism_name ? `Organism ${state.organism_name}` : null,
        state.uniprot_accession ? `UniProt ${state.uniprot_accession}${state.uniprot_reviewed === null ? "" : state.uniprot_reviewed ? " · reviewed" : " · unreviewed"}` : null,
        state.connector_version ? `Connector ${state.connector_version}` : null,
        state.source_checked_at ? `Sources checked ${new Date(state.source_checked_at).toLocaleString()}` : null,
      ].filter((item): item is string => Boolean(item)),
    });
  }
  for (const state of retrievalStates) {
    executionByResource.set(resourceKey("sequence_retrieval", state.id), {
      status: state.status,
      updatedAt: state.updated_at,
      label: `${state.source_provider}/${state.source_database} sequence retrieval`,
      error: state.processing_error,
      summary: {
        requested_accession: state.requested_accession,
        resolved_accession: state.resolved_accession,
        record_title: state.record_title,
        organism: state.organism,
        result_message: state.result_message,
      },
      provenance: [
        state.connector_version ? `Connector ${state.connector_version}` : null,
        state.source_checked_at ? `Source checked ${new Date(state.source_checked_at).toLocaleString()}` : null,
        state.source_retrieved_at ? `Source retrieved ${new Date(state.source_retrieved_at).toLocaleString()}` : null,
        state.source_response_sha256 ? `Source response SHA-256 ${state.source_response_sha256}` : null,
      ].filter((item): item is string => Boolean(item)),
    });
  }
  for (const state of blastStates) {
    executionByResource.set(resourceKey("blast_job", state.id), {
      status: state.status,
      updatedAt: state.updated_at,
      label: `${state.program} · ${state.database_name} · ${state.service_provider}/${state.service_mode}`,
      error: state.processing_error,
      summary: state.result_summary,
      provenance: [
        state.service_version ? `Service ${state.service_version}` : null,
        state.blast_version ? `BLAST ${state.blast_version}` : null,
        state.database_release ? `Database release ${state.database_release}` : null,
        state.raw_result_sha256 ? `Raw result SHA-256 ${state.raw_result_sha256}` : null,
      ].filter((item): item is string => Boolean(item)),
    });
  }

  return (
    <main className="container dashboard">
      <header className="dashboard-header">
        <div>
          <div className="eyebrow">Genithm AI conversation</div>
          <h2>{conversation.title}</h2>
          <p className="small">{project?.name ?? "Project"} · conversation {conversation.id}</p>
        </div>
        <div className="actions" style={{ marginTop: 0 }}>
          <Link className="button" href={`/dashboard/ai/${conversation.id}`}>Refresh execution state</Link>
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
            const execution = plan.dispatched_resource_type && plan.dispatched_resource_id
              ? executionByResource.get(resourceKey(plan.dispatched_resource_type, plan.dispatched_resource_id))
              : null;
            const interpretation = interpretationByPlan.get(plan.id);
            const interpreted = interpretationParts(interpretation?.interpretation);
            const interpretationEligible = canInterpret(plan.dispatched_resource_type, execution?.status ?? null);
            return (
              <div className="item" key={plan.id}>
                <div className="dashboard-header">
                  <div>
                    <strong>{plan.action_type ? readable(plan.action_type) : readable(plan.status)}</strong>
                    <div className="small">Plan status: {readable(plan.status)} · attempts {plan.processing_attempts} · created {new Date(plan.created_at).toLocaleString()}</div>
                  </div>
                  <div className="actions" style={{ marginTop: 0 }}>
                    {plan.status === "ready" && plan.requires_confirmation ? (
                      <form action={approveAiPlan}>
                        <input type="hidden" name="plan_request_id" value={plan.id} />
                        <input type="hidden" name="conversation_id" value={conversation.id} />
                        <button className="button primary">Approve &amp; run</button>
                      </form>
                    ) : null}
                    {plan.status === "dispatched" && href ? <Link className="button" href={href}>Open dispatched work</Link> : null}
                    {plan.status === "dispatched" && execution && interpretationEligible && !interpretation ? (
                      <form action={requestAiInterpretation}>
                        <input type="hidden" name="plan_request_id" value={plan.id} />
                        <input type="hidden" name="conversation_id" value={conversation.id} />
                        <button className="button primary">Interpret recorded result</button>
                      </form>
                    ) : null}
                  </div>
                </div>

                {parsed.summary ? <p>{parsed.summary}</p> : null}
                {parsed.limitations.length ? <div className="notice"><strong>Limitations</strong><div className="small">{parsed.limitations.join(" · ")}</div></div> : null}
                {parameters ? <details style={{ marginTop: 12 }}><summary>Planned parameters</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify(parameters, null, 2)}</pre></details> : null}
                {plan.plan_sha256 ? <div className="small">Plan SHA-256: <code>{plan.plan_sha256}</code></div> : null}
                {plan.provider || plan.model ? <div className="small">Planner: {plan.provider ?? "unknown"}/{plan.model ?? "unknown"}{plan.prompt_version ? ` · prompt ${plan.prompt_version}` : ""} · policy {plan.policy_version}</div> : <div className="small">Policy: {plan.policy_version}</div>}
                {plan.processing_error ? <div className="error">Planning error: {plan.processing_error}</div> : null}
                {plan.status === "ready" ? <div className="notice" style={{ marginTop: 12 }}>Approval does not trust the model output directly. Genithm revalidates the action, current project authorization, referenced resource IDs, and tool-specific constraints before dispatch.</div> : null}

                {plan.status === "dispatched" ? (
                  <div className="notice" style={{ marginTop: 12 }}>
                    <strong>Authoritative execution state</strong>
                    {execution ? (
                      <>
                        <div className="small">Status: {readable(execution.status)} · updated {new Date(execution.updatedAt).toLocaleString()}</div>
                        <div className="small">{execution.label}</div>
                        {execution.error ? <div className="error">Execution error: {execution.error}</div> : null}
                        {execution.provenance.length ? <div className="small" style={{ marginTop: 8 }}>{execution.provenance.join(" · ")}</div> : null}
                        {execution.summary !== null ? (
                          <details style={{ marginTop: 10 }}>
                            <summary>Authoritative result summary</summary>
                            <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify(execution.summary, null, 2)}</pre>
                          </details>
                        ) : null}
                        {interpretationEligible && !interpretation ? <div className="small" style={{ marginTop: 8 }}>This terminal result is eligible for a separate evidence-grounded AI explanation. The evidence snapshot is frozen before it is sent to the interpreter.</div> : null}
                      </>
                    ) : (
                      <div className="small">The dispatched resource is not currently visible in your authorized project scope. Genithm does not infer a result or completion state when the authoritative record cannot be read.</div>
                    )}
                  </div>
                ) : null}

                {interpretation ? (
                  <div className="notice" style={{ marginTop: 12 }}>
                    <strong>Evidence-grounded AI interpretation</strong>
                    <div className="small">Status: {readable(interpretation.status)} · attempts {interpretation.processing_attempts} · evidence SHA-256 <code>{interpretation.evidence_sha256}</code></div>
                    {interpretation.provider || interpretation.model ? <div className="small">Interpreter: {interpretation.provider ?? "unknown"}/{interpretation.model ?? "unknown"}{interpretation.prompt_version ? ` · prompt ${interpretation.prompt_version}` : ""} · policy {interpretation.policy_version}</div> : <div className="small">Policy: {interpretation.policy_version}</div>}
                    {interpretation.processing_error ? <div className="error">Interpretation error: {interpretation.processing_error}</div> : null}
                    {interpretation.status === "completed" && interpreted.summary ? (
                      <>
                        <p>{interpreted.summary}</p>
                        {interpreted.findings.length ? (
                          <div className="list">
                            {interpreted.findings.map((finding, index) => (
                              <div className="item" key={`${interpretation.id}-finding-${index}`}>
                                <div>{finding.statement}</div>
                                <div className="small">Evidence: {finding.evidenceIds.join(", ")}</div>
                              </div>
                            ))}
                          </div>
                        ) : null}
                        {interpreted.limitations.length ? <div className="small" style={{ marginTop: 8 }}><strong>Interpretation limits:</strong> {interpreted.limitations.join(" · ")}</div> : null}
                        {interpretation.interpretation_sha256 ? <div className="small" style={{ marginTop: 8 }}>Interpretation SHA-256: <code>{interpretation.interpretation_sha256}</code></div> : null}
                      </>
                    ) : null}
                    <div className="small" style={{ marginTop: 8 }}>This is a model explanation of the frozen recorded evidence, not a new experiment, source lookup, tool run, or independent scientific verification.</div>
                  </div>
                ) : null}
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
              <div className="small">{readable(message.message_kind)} · {new Date(message.created_at).toLocaleString()}</div>
              <p style={{ whiteSpace: "pre-wrap" }}>{message.content}</p>
            </div>
          ))}
          {!messages?.length ? <div className="notice">No messages yet.</div> : null}
        </div>
      </section>
    </main>
  );
}
