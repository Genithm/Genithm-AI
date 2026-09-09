import type { Json } from "@/lib/report-database.types";

import { createClient } from "@/lib/supabase/server";

export type GovernanceVerification = {
  valid?: boolean;
  event_count?: number;
  head_sequence?: number;
  head_hash?: string;
  chain_version?: string;
};

export async function getPlatformAdminGovernanceData() {
  const supabase = await createClient();

  const [rosterResult, eventsResult, verificationResult] = await Promise.all([
    supabase.rpc("get_platform_admin_roster"),
    supabase.rpc("get_platform_admin_governance_events", {
      page_size: 50,
      page_offset: 0,
    }),
    supabase.rpc("verify_platform_admin_governance_chain"),
  ]);

  return {
    roster: rosterResult.data ?? [],
    events: eventsResult.data ?? [],
    verification: (verificationResult.data ?? {}) as Json as GovernanceVerification,
    errors: {
      roster: rosterResult.error,
      events: eventsResult.error,
      verification: verificationResult.error,
    },
  };
}
