import { createClient } from "@/lib/supabase/server";

export async function getSecurityControlPlaneData() {
  const supabase = await createClient();

  const [summaryResult, eventsResult, signalsResult] = await Promise.all([
    supabase.rpc("get_security_operations_summary"),
    supabase.rpc("get_recent_security_events", { event_limit: 50 }),
    supabase.rpc("get_recent_security_detection_signals", { signal_limit: 50 }),
  ]);

  return {
    summary: summaryResult.data ?? null,
    events: eventsResult.data ?? [],
    signals: signalsResult.data ?? [],
    errors: {
      summary: summaryResult.error,
      events: eventsResult.error,
      signals: signalsResult.error,
    },
  };
}
