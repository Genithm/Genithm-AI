import { createClient } from "@/lib/supabase/server";

export async function getSecurityOperationsData() {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("get_security_operations_summary");

  if (error) {
    return {
      summary: null,
      error: error.message,
    };
  }

  return {
    summary: data,
    error: null,
  };
}
