import "server-only";

import { createServiceClient } from "@/lib/supabase/service";
import { scienceV22Configured } from "@/lib/science-release";
import {
  scienceOperationsStatus,
  type ScienceOperationsStatus,
} from "@/lib/science-operations-status";

export type ScienceOperationsOverview = {
  status: ScienceOperationsStatus;
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
    const [readiness, schema] = await Promise.all([
      service.rpc("get_release_readiness"),
      service.from("ai_messages")
        .select("id,protocol_input_scope,research_pipeline_run_id")
        .limit(0),
    ]);
    const status = scienceOperationsStatus(readiness.error ? null : readiness.data);
    const schemaReady = !schema.error;
    return {
      status,
      fixedResearchConfigured: configured,
      schemaReady,
      acceptance: configured && schemaReady && status.health === "ready"
        ? "eligible" : "blocked",
    };
  } catch {
    return {
      status: scienceOperationsStatus(null),
      fixedResearchConfigured: configured,
      schemaReady: false,
      acceptance: "blocked",
    };
  }
}
