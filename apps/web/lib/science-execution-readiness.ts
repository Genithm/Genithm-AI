import "server-only";

import { createServiceClient } from "@/lib/supabase/service";
import { scienceWorkersReady } from "@/lib/science-worker-readiness";

/**
 * Fail closed when no server-side Supabase service key, no RPC permission,
 * or any required worker/queue has an expired heartbeat.
 * This does not change the independent source-message approval/RLS rules.
 */
export async function scienceExecutionReady(
  service: ReturnType<typeof createServiceClient> = createServiceClient(),
): Promise<boolean> {
  try {
    const { data, error } = await service.rpc("get_release_readiness");
    return !error && scienceWorkersReady(data);
  } catch {
    return false;
  }
}
