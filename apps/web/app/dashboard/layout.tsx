import { redirect } from "next/navigation";
import { AnalysisLaunchGuard } from "@/components/analysis-launch-guard";
import { GenithmWorkspaceFrame } from "@/components/genithm-workspace-frame";
import { createClient } from "@/lib/supabase/server";
import "./dashboard-section-nav.css";
import "./dashboard-polish.css";
import "./workspace-chrome.css";

export default async function DashboardLayout({children}:Readonly<{children:React.ReactNode}>) {
  const supabase = await createClient();
  const [{data:claimsData,error:claimsError},{data:isPlatformAdmin}] = await Promise.all([
    supabase.auth.getClaims(), supabase.rpc("is_platform_admin"),
  ]);
  const claims = claimsData?.claims;
  if (claimsError || !claims?.sub) redirect("/login?message=" + encodeURIComponent("Your session expired. Please sign in again."));
  return <GenithmWorkspaceFrame email={String(claims.email ?? "Researcher")} isPlatformAdmin={Boolean(isPlatformAdmin)}>
    <AnalysisLaunchGuard />
    {children}
  </GenithmWorkspaceFrame>;
}
