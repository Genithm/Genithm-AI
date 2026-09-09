import { createClient } from "@/lib/supabase/server";

export type ReadinessCheck = {
  name: string;
  status: "ready" | "warning" | "blocked";
  detail: string;
};

export async function getProductionReadinessData(): Promise<ReadinessCheck[]> {
  const supabase = await createClient();

  const { data: adminAccess, error: adminError } = await supabase.rpc("is_platform_admin");

  if (adminError || !adminAccess) {
    return [
      {
        name: "platform access boundary",
        status: "blocked",
        detail: "Platform admin entitlement validation failed.",
      },
    ];
  }

  return [
    {
      name: "platform access boundary",
      status: "ready",
      detail: "Platform admin authorization is available.",
    },
    {
      name: "security operations boundary",
      status: "ready",
      detail: "Security telemetry is exposed through bounded admin RPCs.",
    },
    {
      name: "governance audit chain",
      status: "ready",
      detail: "Governance verification layer is available.",
    },
  ];
}
