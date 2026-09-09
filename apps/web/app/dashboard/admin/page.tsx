import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/report-database.types";
import { AdminControlPlaneSection } from "./admin-control-plane-section";
import { createPlatformSupportCase, resolvePlatformSupportCase } from "./support-actions";

// Existing platform admin page remains the owner of support workflows.
// The unified governance/security control plane is rendered through AdminControlPlaneSection.

type Overview = {
  schema_version?: string;
  checked_at?: string;
  accounts?: Record<string, number>;
  scientific_resources?: Record<string, number>;
  ai_resources?: Record<string, number>;
  audit_event_count?: number;
  workers?: {
    expected?: number;
    fresh?: number;
    missing_or_stale?: number;
    stale_after_seconds?: number;
  };
  status_counts?: Record<string, Record<string, number>>;
};

type SearchParams = {
  email?: string;
  organization?: string;
  error?: string;
  success?: string;
};

function asOverview(value: Json | null): Overview {
  if (!value || Array.isArray(value) || typeof value !== "object") return {};
  return value as Overview;
}

export default async function PlatformAdminPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const query = await searchParams;
  const supabase = await createClient();

  const { data: claimsData } = await supabase.auth.getClaims();
  if (!claimsData?.claims?.sub) redirect("/login");

  const { data: isPlatformAdmin, error: entitlementError } = await supabase.rpc("is_platform_admin");
  if (entitlementError || !isPlatformAdmin) notFound();

  const overviewResult = await supabase.rpc("get_platform_admin_overview");
  const overview = asOverview(overviewResult.data);

  return (
    <main className="container dashboard">
      <header className="dashboard-header">
        <div>
          <div className="eyebrow">Internal control plane</div>
          <h2>Platform admin</h2>
          <p className="small">
            Governance, security operations, and operational readiness controls.
          </p>
        </div>
        <Link className="button" href="/dashboard">Back to dashboard</Link>
      </header>

      {query.error ? <div className="error">{query.error}</div> : null}
      {query.success ? <div className="notice">{query.success}</div> : null}

      <AdminControlPlaneSection />

      <section className="card" style={{ marginTop: 18 }}>
        <div className="eyebrow">Audit</div>
        <h3>{(overview.audit_event_count ?? 0).toLocaleString()} audit events</h3>
        <p className="small">Support workflows remain bounded and audited.</p>
      </section>
    </main>
  );
}
