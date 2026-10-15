import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AiChatComposer } from "@/components/ai-chat-composer";
import { createClient } from "@/lib/supabase/server";
import { recordedEvidenceMetrics } from "@/lib/recorded-chat-evidence";
import { approveAiPlan, requestAiInterpretation, approveChatResearchProtocol } from "../actions";
import { parseChatResearchProtocol, pipelineProgress } from "@/lib/chat-research-protocol";
import styles from "./conversation.module.css";
import { ResearchActivityRefresh } from "@/components/research-activity-refresh";
import { ConversationDossierPanel } from "@/components/conversation-dossier-panel";
import { buildConversationDossier } from "@/lib/conversation-research-dossier";

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
  searchParams: Promise<{ error?: string; pipeline_id?: string }>;
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
      .select("id,role,content,message_kind,plan_request_id,attachment_upload_ids,protocol_input_scope,research_pipeline_run_id,created_at")
      .eq("conversation_id", id)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
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

  // Fetch the newest bounded window, but render the conversation oldest-first.
  const chronologicalMessages = [...(messages ?? [])].reverse();

  // Science V22: the message-to-run link is persisted by the atomic approval
  // RPC. Reopen/refresh resolves only runs bound to the current conversation,
  // not other pipeline runs sharing this project or accession.
  const linkedPipelineIds = [...new Set(chronologicalMessages
    .map((message) => message.research_pipeline_run_id)
    .filter((runId): runId is string => Boolean(runId)))].slice(-100);
  const { data: linkedPipelines } = linkedPipelineIds.length
    ? await supabase.from("research_pipeline_runs")
        .select("id,status,template,requested_accession,project_id,requested_by,retrieval_id,sequence_upload_id,scientific_job_id,sequence_sha256")
        .eq("project_id", conversation.project_id)
        .eq("requested_by", claimsData.claims.sub)
        .in("id", linkedPipelineIds)
    : { data: [] as Array<{ id: string; status: string; template: string; requested_accession: string; project_id: string; requested_by: string; retrieval_id: string; sequence_upload_id: string | null; scientific_job_id: string | null; sequence_sha256: string | null }> };
  const linkedPipelineById = new Map((linkedPipelines ?? []).map((run) => [run.id, run]));
  const requestedPipelineId = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(query.pipeline_id ?? "") &&
    linkedPipelineById.has(query.pipeline_id ?? "") ? query.pipeline_id : null;
  const pipelineId = requestedPipelineId ?? [...linkedPipelineIds].reverse()
    .find((id) => linkedPipelineById.has(id)) ?? null;
  const { data: pipeline } = pipelineId
    ? await supabase.from("research_pipeline_runs")
        .select("id,project_id,requested_by,template,requested_accession,retrieval_id,sequence_upload_id,scientific_job_id,status,failure_stage,failure_code,sequence_sha256")
        .eq("id", pipelineId).eq("project_id", conversation.project_id)
        .eq("requested_by", claimsData.claims.sub).maybeSingle()
    : { data: null };
  const [{ data: pipelineRetrieval }, { data: pipelineSequence }, { data: pipelineScience }] = await Promise.all([
    pipeline?.retrieval_id
      ? supabase.from("sequence_retrievals").select("id,status,resolved_accession")
          .eq("id", pipeline.retrieval_id).eq("project_id", conversation.project_id).maybeSingle()
      : Promise.resolve({ data: null }),
    pipeline?.sequence_upload_id
      ? supabase.from("sequence_uploads").select("id,status")
          .eq("id", pipeline.sequence_upload_id).eq("project_id", conversation.project_id).maybeSingle()
      : Promise.resolve({ data: null }),
    pipeline?.scientific_job_id
      ? supabase.from("scientific_jobs").select("id,status,job_type,result_sha256,result_object_path,result_summary")
          .eq("id", pipeline.scientific_job_id).eq("project_id", conversation.project_id)
          .eq("requested_by", claimsData.claims.sub).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const protocolTemplate = pipeline?.template === "ncbi_nucleotide_orf_v1" || pipeline?.template === "ncbi_protein_profile_v1"
    ? pipeline.template : null;
  const pipelineSteps = protocolTemplate
    ? pipelineProgress(protocolTemplate, pipeline?.status ?? "", pipelineRetrieval?.status ?? null, pipelineSequence?.status ?? null, pipelineScience?.status ?? null)
    : [];

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
      ? supabase.from("scientific_jobs").select("id,status,job_type,result_summary,result_sha256,result_object_path,processing_error,updated_at").in("id", scientificIds)
      : Promise.resolve({ data: [] }),
    annotationIds.length
      ? supabase.from("protein_annotation_jobs").select("id,status,refseq_accession,uniprot_accession,protein_name,uniprot_reviewed,processing_error,updated_at").in("id", annotationIds)
      : Promise.resolve({ data: [] }),
    retrievalIds.length
      ? supabase.from("sequence_retrievals").select("id,status,resolved_accession,source_database,sequence_upload_id,processing_error,updated_at").in("id", retrievalIds)
      : Promise.resolve({ data: [] }),
    blastIds.length
      ? supabase.from("blast_jobs").select("id,status,result_summary,raw_result_sha256,processing_error,updated_at").in("id", blastIds)
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

  // Child scientific jobs are inspected under the researcher's RLS session.
  // The workflow's own "completed" label is never enough for the dossier.
  const workflowChildIds = [...new Set((workflows.data ?? []).flatMap((workflow) =>
    [workflow.msa_job_id, workflow.phylogeny_job_id].filter((item): item is string => Boolean(item))
  ))].slice(0, 200);
  const { data: workflowChildJobs } = workflowChildIds.length
    ? await supabase.from("scientific_jobs")
        .select("id,status,job_type,result_sha256,result_object_path")
        .eq("project_id", conversation.project_id)
        .in("id", workflowChildIds)
    : { data: [] };

  const scientificById = new Map((scientific.data ?? []).map((row) => [row.id, row]));
  const annotationById = new Map((annotations.data ?? []).map((row) => [row.id, row]));
  const retrievalById = new Map((retrievals.data ?? []).map((row) => [row.id, row]));
  const blastById = new Map((blasts.data ?? []).map((row) => [row.id, row]));
  const activityPlans = (plans ?? []).filter((plan) =>
    ["ready", "dispatched"].includes(plan.status) || (plan.status === "error" && Boolean(plan.action_type)),
  );

  // V23: batch-read every fixed pipeline dependency through the researcher's
  // RLS session. A saved chat link is a locator, never proof of completed work.
  const fixedRetrievalIds = [...new Set((linkedPipelines ?? []).map((run) => run.retrieval_id))];
  const fixedSequenceIds = [...new Set((linkedPipelines ?? [])
    .map((run) => run.sequence_upload_id).filter((id): id is string => Boolean(id)))];
  const fixedScientificIds = [...new Set((linkedPipelines ?? [])
    .map((run) => run.scientific_job_id).filter((id): id is string => Boolean(id)))];
  const [{ data: fixedRetrievals }, { data: fixedSequences }, { data: fixedScientificJobs }, { data: fixedJobInputs }] = await Promise.all([
    fixedRetrievalIds.length
      ? supabase.from("sequence_retrievals")
          .select("id,status,resolved_accession,source_database,requested_accession,sequence_upload_id")
          .eq("project_id", conversation.project_id)
          .eq("requested_by", claimsData.claims.sub)
          .in("id", fixedRetrievalIds)
      : Promise.resolve({ data: [] }),
    fixedSequenceIds.length
      ? supabase.from("sequence_uploads")
          .select("id,status,sha256")
          .eq("project_id", conversation.project_id)
          .eq("created_by", claimsData.claims.sub)
          .in("id", fixedSequenceIds)
      : Promise.resolve({ data: [] }),
    fixedScientificIds.length
      ? supabase.from("scientific_jobs")
          .select("id,status,job_type,parameters,result_sha256,result_object_path,result_summary")
          .eq("project_id", conversation.project_id)
          .eq("requested_by", claimsData.claims.sub)
          .in("id", fixedScientificIds)
      : Promise.resolve({ data: [] }),
    fixedScientificIds.length
      ? supabase.from("scientific_job_inputs")
          .select("job_id,sequence_upload_id,input_sha256,input_position")
          .eq("project_id", conversation.project_id)
          .in("job_id", fixedScientificIds)
      : Promise.resolve({ data: [] }),
  ]);

  const dossier = buildConversationDossier({
    conversationId: conversation.id,
    plans: activityPlans,
    scientificJobs: scientific.data ?? [],
    blastJobs: blasts.data ?? [],
    retrievals: retrievals.data ?? [],
    annotations: annotations.data ?? [],
    workflows: workflows.data ?? [],
    workflowChildJobs: workflowChildJobs ?? [],
    fixedPipelines: linkedPipelines ?? [],
    fixedRetrievals: fixedRetrievals ?? [],
    fixedSequences: fixedSequences ?? [],
    fixedScientificJobs: fixedScientificJobs ?? [],
    fixedJobInputs: fixedJobInputs ?? [],
  });
  // Use the same independently checked evidence decision in the selected-run
  // panel and exported dossier. Parent/child status flags alone are not proof.
  const selectedPipelineEvidence = dossier.findings.find((finding) =>
    finding.source === "fixed_pipeline" && finding.pipeline_id === pipelineId
  ) ?? null;

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
          {chronologicalMessages.map((message) => (
            <article
              className={message.role === "user" ? styles.userMessage : styles.assistantMessage}
              key={message.id}
            >
              <div className={styles.messageMeta}>
                {message.role === "user" ? "You" : "Genithm"}
              </div>
              <div className={styles.messageBody}>{message.content}</div>
              {message.role === "user" && message.protocol_input_scope === "text_only" &&
                (message.attachment_upload_ids?.length ?? 0) === 0 && !message.research_pipeline_run_id &&
                parseChatResearchProtocol(message.content) ? (
                <form action={approveChatResearchProtocol} className={styles.protocolApproval}>
                  <input type="hidden" name="conversation_id" value={conversation.id} />
                  <input type="hidden" name="message_id" value={message.id} />
                  <div className={styles.protocolTitle}>Fixed, two-stage research protocol available</div>
                  <p>NCBI retrieval → validated FASTA → authorized scientific calculation. Nothing starts without your approval.</p>
                  <button className="button primary" type="submit">Approve complete research protocol</button>
                </form>
              ) : null}
              {message.research_pipeline_run_id && linkedPipelineById.has(message.research_pipeline_run_id) ? (
                <Link className={styles.download} href={`/dashboard/ai/${conversation.id}?pipeline_id=${message.research_pipeline_run_id}`}>
                  View approved research · {readable(linkedPipelineById.get(message.research_pipeline_run_id)?.status)}
                </Link>
              ) : null}
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

        <ResearchActivityRefresh active={Boolean((linkedPipelines ?? []).some((run) => ["awaiting_source", "awaiting_validation", "running"].includes(run.status)) || (pipeline && ["awaiting_source", "awaiting_validation", "running"].includes(pipeline.status)) || (plans ?? []).some((plan) => ["queued", "planning", "processing"].includes(plan.status)) || (interpretations ?? []).some((item) => ["queued", "running", "processing"].includes(item.status)) || [...execution.values()].some((entry) => ["queued", "running", "processing", "pending"].includes(entry.status)))} />

        <section className={styles.activity} aria-label="Scientific research results and execution">
          <h2 className={styles.activityTitle}>Research activity · progress &amp; results</h2>
          <p className={styles.activityDescription}>Your analyses run in the background. Approve, track and review their results here without leaving this conversation.</p>
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
              const evidenceType = plan.dispatched_resource_type;
              const evidenceRow =
                evidenceType === "scientific_job" ? scientificResult :
                evidenceType === "blast_job" ? blastById.get(plan.dispatched_resource_id ?? "") :
                evidenceType === "sequence_retrieval" ? retrievalById.get(plan.dispatched_resource_id ?? "") :
                evidenceType === "protein_annotation_job" ? annotationById.get(plan.dispatched_resource_id ?? "") :
                null;
              const findings = evidenceType && (
                evidenceType === "scientific_job" || evidenceType === "blast_job" ||
                evidenceType === "sequence_retrieval" || evidenceType === "protein_annotation_job"
              ) ? recordedEvidenceMetrics(evidenceType, evidenceRow) : [];

              return (
                <div className={styles.activityCard} key={plan.id}>
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
                      {plan.status === "ready" ? (
                        <form action={approveAiPlan}>
                          <input type="hidden" name="plan_request_id" value={plan.id} />
                          <input type="hidden" name="conversation_id" value={conversation.id} />
                          <button className="button primary" type="submit">Approve this analysis</button>
                        </form>
                      ) : null}
                      {href ? <details className={styles.evidenceDetails}><summary>{workflow ? "View workflow evidence" : "View result and evidence"}</summary><p>Scientific evidence is available in the verified results workspace. This link opens the full report and provenance record.</p><Link className="button" href={href}>Open verified evidence</Link></details> : null}
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
                  {findings.length ? <div className={styles.findings} aria-label="Recorded scientific findings">{findings.map((item) => <div className={styles.finding} key={item.label}><span>{item.label}</span><strong>{item.value}</strong></div>)}</div> : null}
                  {scientificResult?.status === "completed" && scientificResult.result_sha256 ? <div className={styles.muted}>Recorded result fingerprint: <code>{scientificResult.result_sha256}</code></div> : null}
                  {scientificResult?.status === "completed" && scientificResult.result_sha256 && scientificResult.result_object_path ? <a className={styles.download} href={`/dashboard/scientific-jobs/${scientificResult.id}/download`}>Download verified scientific result JSON</a> : null}
                  {state?.error ? <div className="error">{state.error}</div> : null}
                  {plan.processing_error ? <div className="error">{plan.processing_error}</div> : null}
                  {interpretation?.processing_error ? <div className="error">{interpretation.processing_error}</div> : null}
                  {interpretation?.status === "completed" && interpretationSummary(interpretation.interpretation) ? (
                    <div className={styles.interpretation}>
                      <strong>Genithm interpretation</strong>
                      <p>{interpretationSummary(interpretation.interpretation)}</p>
                    </div>
                  ) : null}
                </div>
              );
            })}
            {!activityPlans.length && !(linkedPipelines ?? []).length ? <div className={styles.empty}>No scientific activity yet.</div> : null}
          </div>
        </section>

        {pipeline && protocolTemplate ? (
          <section className={styles.protocolRun} aria-label="Active chat research protocol">
            <div className={styles.protocolTitle}>Approved multi-step research · {protocolTemplate === "ncbi_nucleotide_orf_v1" ? "Nucleotide ORF analysis" : "Protein profiling"}</div>
            <p>NCBI reference: <code>{pipeline.requested_accession}</code> · Engine status: <strong>{readable(pipeline.status)}</strong> · Evidence status: <strong>{readable(selectedPipelineEvidence?.state)}</strong></p>
            <ol className={styles.protocolSteps}>
              {pipelineSteps.map((step) => (
                <li key={step.name}><strong>{step.name}</strong><span>{readable(step.status)}</span></li>
              ))}
            </ol>
            {selectedPipelineEvidence?.state === "completed" && selectedPipelineEvidence.verified_download ? (
              <a className={styles.download} href={selectedPipelineEvidence.verified_download}>Download integrity-checked scientific result</a>
            ) : null}
            {selectedPipelineEvidence?.state === "completed" && selectedPipelineEvidence.metrics.length ? (
              <div className={styles.findings} aria-label="Verified in-chat protocol findings">
                {selectedPipelineEvidence.metrics.map((metric) => (
                  <div className={styles.finding} key={metric.label}><span>{metric.label}</span><strong>{metric.value}</strong></div>
                ))}
              </div>
            ) : null}
            {pipeline.status === "error" ? <p className="error">Research stopped safely at {readable(pipeline.failure_stage)}: {readable(pipeline.failure_code)}</p> : null}
            {pipeline.status === "completed" && selectedPipelineEvidence?.state !== "completed" ? (
              <p className={styles.muted}>The engine recorded completion, but the original source-to-result evidence could not be fully verified. No scientific measurements or result download are presented as verified.</p>
            ) : null}
            {selectedPipelineEvidence?.state === "completed" ? <p>The recorded NCBI source, validated FASTA, scientific input, parameters and result metadata agree. Artifact bytes are checked when downloaded.</p> : null}
          </section>
        ) : null}

        <ConversationDossierPanel dossier={dossier} />

        <AiChatComposer
          key={`${conversation.id}:${messages?.length ?? 0}`}
          projects={[{ id: conversation.project_id, name: project?.name ?? "Research project" }]}
          conversationId={conversation.id}
          defaultProjectId={conversation.project_id}
          placeholder="Ask a follow-up, paste an accession or attach another FASTA file..."
        />
      </section>
    </main>
  );
}
