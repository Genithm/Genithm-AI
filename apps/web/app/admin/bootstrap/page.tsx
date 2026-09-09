import { notFound, redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import PlatformAdminBootstrapClient from "./bootstrap-client";

export default async function PlatformAdminBootstrapPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const query = await searchParams;
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = typeof claimsData?.claims?.sub === "string" ? claimsData.claims.sub : null;
  if (!userId) redirect("/login");

  const configuredUserId = process.env.GENITHM_BOOTSTRAP_ADMIN_USER_ID?.trim() ?? "";
  if (!configuredUserId || configuredUserId !== userId) notFound();

  const { data: isPlatformAdmin } = await supabase.rpc("is_platform_admin");
  if (isPlatformAdmin) redirect("/dashboard/admin");

  return (
    <main className="container">
      <section className="auth-shell card">
        <div className="eyebrow">One-time operator activation</div>
        <h2>Platform admin provisioning</h2>
        <p>
          This page is available only to the server-configured bootstrap account. Activation requires a verified
          authenticator and an AAL2 session. Once any platform admin exists, the database bootstrap permanently closes.
        </p>
        {query.error ? <div className="error">{query.error}</div> : null}
        <div className="notice">
          Signed-in bootstrap account: <code>{userId}</code>
        </div>
        <PlatformAdminBootstrapClient />
      </section>
    </main>
  );
}
