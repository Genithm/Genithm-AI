import "server-only";

import { createServiceClient } from "@/lib/supabase/service";
import { scienceV22Configured } from "@/lib/science-release";
import {
  scienceOperationsStatus,
  type ScienceOperationsStatus,
} from "@/lib/science-operations-status";

export type PipelineStateCounts = {
  awaiting_source: number | null;
  awaiting_validation: number | null;
  running: number | null;
  completed: number | null;
  error: number | null;
};

const EMPTY_COUNTS: PipelineStateCounts = {
  awaiting_source: null,
  awaiting_validation: null,
  running: null,
  completed: null,
  error: null,
};

export type ScienceOperationsOverview = {
  status: ScienceOperationsStatus;
  pipelineCounts: PipelineStateCounts;
  fixedResearchConfigured: boolean;
  schemaReady: boolean;
  acceptance: "eligible" | "blocked";
};

/**
 * Admin-only caller boundary: the route/page MUST confirm session claims
 * and is_platform_admin using the end-user client *before* calling this.
 *
 * Keep privileged keys on the server. All raw RPC errors and arbitrary
 * telemetry fields are discarded before returning an allowlisted summary.
 */
export async function readScienceOperationsOverview(): Promise<ScienceOperationsOverview> {
  const configured = scienceV22Configured();
  try {
    const service = createServiceClient();
    const states = ["awaiting_source", "awaiting_validation", "running", "completed", "error"] as const;
    const [readiness, schema, ...countResults] = await Promise.all([
      service.rpc("get_release_readiness"),
      service.from("ai_messages")
        .select("id,protocol_input_scope,research_pipeline_run_id")
        .limit(0),
      ...states.map((state) =>
        service.from("research_pipeline_runs")
          .select("id", { count: "exact", head: true })
          .eq("status", state)
      ),
    ]);
    // Only aggregates are returned; no tenant IDs, accessions, messages or
    // scientific artifacts escape the backend service-role query.
    const pipelineCounts = Object.fromEntries(states.map((state, index) => [
      state,
      countResults[index].error ? null : countResults[index].count,
    ])) as PipelineStateCounts;
    const status = scienceOperationsStatus(readiness.error ? null : readiness.data);
    const schemaReady = !schema.error;
    return {
      status,
      pipelineCounts,
      fixedResearchConfigured: configured,
      schemaReady,
      acceptance: configured && schemaReady && status.health === "ready"
        ? "eligible" : "blocked",
    };
  } catch {
    return {
      status: scienceOperationsStatus(null),
      pipelineCounts: { ...EMPTY_COUNTS },
      fixedResearchConfigured: configured,
      schemaReady: false,
      acceptance: "blocked",
    };
  }
}
