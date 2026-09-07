import { createBrowserClient } from "@supabase/ssr";

import type { Database } from "@/lib/ai-database.types";
import { getSupabasePublicEnv } from "@/lib/env";

export function createClient() {
  const { url, publishableKey } = getSupabasePublicEnv();
  return createBrowserClient<Database>(url, publishableKey);
}
