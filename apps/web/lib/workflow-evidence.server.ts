import "server-only";

import { createClient } from "@/lib/supabase/server";
import {
  UUID_RE, reconcileWorkflow, type WorkflowRun, type ScientificStep,
  type WorkflowDependency, type WorkflowDiagnostic,
} from "@/lib/workflow-reconciliation";

type WorkflowResult =
  | { ok: true; value: WorkflowDiagnostic }
  | { ok: false; status: 401 | 404 | 503 };

/**
 * Every SELECT below is made with the current request's authenticated RLS client.
 * No service-role override or untrusted path/resource parameter is accepted.
 */
export async function loadWorkflowDiagnostic(id: string): Promise<WorkflowResult> {
  if (!UUID_RE.test(id)) return { ok: false, status: 404 };
  const supabase = await createClient();
  const { data: claims, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError || !claims?.claims?.sub) return { ok: false, status: 401 };

  const { data: workflow, error: workflowError } = await supabase
    .from("ai_workflow_runs")
    .select("id,organization_id,project_id,requested_by,conversation_id,workflow_type,status,msa_job_id,phylogeny_job_id,created_at,updated_at,finished_at")
    .eq("id", id)
    .maybeSingle();
  if (workflowError) return { ok: false, status: 503 };
  if (!workflow || workflow.requested_by !== claims.claims.sub) return { ok: false, status: 404 };

  const record: WorkflowRun = workflow;
  const stepFields = "id,organization_id,project_id,requested_by,job_type,status,created_at,updated_at,processing_started_at,processing_finished_at,processing_attempts,result_sha256" as const;

  const [msaResult, treeResult, depResult] = await Promise.all([
    supabase.from("scientific_jobs")
      .select(stepFields)
      .eq("id", record.msa_job_id)
      .eq("organization_id", record.organization_id)
      .eq("project_id", record.project_id)
      .eq("requested_by", record.requested_by)
      .maybeSingle(),
    record.phylogeny_job_id
      ? supabase.from("scientific_jobs")
          .select(stepFields)
          .eq("id", record.phylogeny_job_id)
          .eq("organization_id", record.organization_id)
          .eq("project_id", record.project_id)
          .eq("requested_by", record.requested_by)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    record.phylogeny_job_id
      ? supabase.from("scientific_job_dependencies")
          .select("job_id,dependency_job_id,organization_id,project_id,dependency_role,dependency_result_sha256")
          .eq("job_id", record.phylogeny_job_id)
          .eq("dependency_job_id", record.msa_job_id)
          .eq("organization_id", record.organization_id)
          .eq("project_id", record.project_id)
          .eq("dependency_role", "source_msa")
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (msaResult.error || treeResult.error || depResult.error) return { ok: false, status: 503 };
  try {
    return {
      ok: true,
      value: reconcileWorkflow(
        record,
        msaResult.data as ScientificStep | null,
        treeResult.data as ScientificStep | null,
        depResult.data as WorkflowDependency | null,
        Date.now(),
      ),
    };
  } catch {
    // Do not return raw SQL, source evidence, secrets or internal exception text.
    return { ok: false, status: 503 };
  }
}
