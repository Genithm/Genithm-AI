import "server-only";

import { createClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/report-database.types";
import { getSupabasePublicEnv } from "@/lib/env";

export function createServiceClient() {
  const { url } = getSupabasePublicEnv();
  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!secretKey) throw new Error("Missing SUPABASE_SECRET_KEY");

  return createClient<Database>(url, secretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}
