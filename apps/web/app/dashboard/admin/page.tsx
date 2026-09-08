import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/report-database.types";
import { createPlatformSupportCase, resolvePlatformSupportCase } from "./support-actions";

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

function metricCards(metrics: Record<string, number> | undefined) {
  if (!metrics) return <div className="notice">No aggregate metrics are available.</div>;
  return (
    <div className="list">
      {Object.entries(metrics).map(([key, value]) => (
        <div className="item" key={key}>
          <strong>{key.replaceAll("_", " ")}</strong>
          <div className="small">{value.toLocaleString()}</div>
        </div>
      ))}
    </div>
  );
}

function orgHref(organizationId: string, email?: string) {
  const params = new URLSearchParams({ organization: organizationId });
  if (email) params.set("email", email);
  return `/dashboard/admin?${params.toString()}`;
}

export default async function PlatformAdminPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const query = await searchParams;
  const exactEmail = String(query.email ?? "").trim();
  const selectedOrganizationId = String(query.organization ?? "").trim();

  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (!claimsData?.claims?.sub) redirect("/login");

  const { data: isPlatformAdmin, error: entitlementError } = await supabase.rpc("is_platform_admin");
  if (entitlementError || !isPlatformAdmin) notFound();

  const [overviewResult, organizationsResult, supportUserResult] = await Promise.all([
    supabase.rpc("get_platform_admin_overview"),
    supabase.rpc("get_platform_admin_organizations", { page_size: 50, page_offset: 0 }),
    exactEmail
      ? supabase.rpc("lookup_platform_support_user", { exact_email: exactEmail })
      : Promise.resolve({ data: [], error: null }),
  ]);

  const supportUser = supportUserResult.data?.[0] ?? null;
  const [membershipsResult, supportCasesResult] = await Promise.all([
    supportUser
      ? supabase.rpc("get_platform_support_user_memberships", { user_id: supportUser.user_id })
      : Promise.resolve({ data: [], error: null }),
    selectedOrganizationId
      ? supabase.rpc("get_platform_support_cases", {
          organization_id: selectedOrganizationId,
          page_size: 50,
          page_offset: 0,
        })
      : Promise.resolve({ data: [], error: null }),
  ]);

  const overview = asOverview(overviewResult.data);
  const workers = overview.workers ?? {};
  const selectedOrganization = (organizationsResult.data ?? []).find(
    (organization) => organization.organization_id === selectedOrganizationId,
  );
  const supportUserMembership = (membershipsResult.data ?? []).find(
    (membership) => membership.organization_id === selectedOrganizationId,
  );

  return (
    <main className="container dashboard">
      <header className="dashboard-header">
        <div>
          <div className="eyebrow">Internal control plane</div>
          <h2>Platform admin</h2>
          <p className="small">
            Aggregate operational visibility plus tightly bounded support workflows. Scientific payloads, passwords,
            credentials, impersonation, destructive user actions, and raw payment instruments stay outside this surface.
          </p>
        </div>
        <Link className="button" href="/dashboard">Back to dashboard</Link>
      </header>

      {query.error ? <div className="error">{query.error}</div> : null}
      {query.success ? <div className="notice">{query.success}</div> : null}
      {overviewResult.error ? <div className="error">Platform overview could not be loaded.</div> : null}
      {organizationsResult.error ? <div className="error">Organization summaries could not be loaded.</div> : null}

      <section className="card">
        <div className="eyebrow">Access boundary</div>
        <h3>Operator-managed entitlement</h3>
        <p className="small">
          Platform admin access is stored in a private database registry and cannot be self-granted. Read-only support
          lookup requires platform-admin entitlement; support case create/resolve additionally requires an AAL2/MFA session.
        </p>
      </section>

      <section className="card" style={{ marginTop: 18 }}>
        <div className="eyebrow">Support lookup</div>
        <h3>Find one account by exact email</h3>
        <p className="small">No fuzzy search or bulk user directory is exposed. Enter the exact account email.</p>
        <form method="get" className="actions" style={{ marginTop: 10 }}>
          <input name="email" type="email" required defaultValue={exactEmail} placeholder="researcher@example.org" />
          {selectedOrganizationId ? <input type="hidden" name="organization" value={selectedOrganizationId} /> : null}
          <button className="button primary" type="submit">Lookup account</button>
          {exactEmail ? <Link className="button" href="/dashboard/admin">Clear</Link> : null}
        </form>

        {supportUserResult.error ? <div className="error" style={{ marginTop: 10 }}>Account lookup failed.</div> : null}
        {exactEmail && !supportUserResult.error && !supportUser ? (
          <div className="notice" style={{ marginTop: 10 }}>No account matches that exact email.</div>
        ) : null}
        {supportUser ? (
          <div className="item" style={{ marginTop: 10 }}>
            <strong>{supportUser.display_name ?? "Unnamed account"}</strong>
            <div className="small">{supportUser.email}</div>
            <div className="small">User ID <code>{supportUser.user_id}</code></div>
            <div className="small">
              Created {new Date(supportUser.created_at).toLocaleString()} · last sign-in {supportUser.last_sign_in_at ? new Date(supportUser.last_sign_in_at).toLocaleString() : "never"}
            </div>
            <div className="small">
              Email confirmed {supportUser.email_confirmed_at ? new Date(supportUser.email_confirmed_at).toLocaleString() : "no"} · {Number(supportUser.organization_count).toLocaleString()} organizations · {Number(supportUser.project_count).toLocaleString()} accessible projects
            </div>
          </div>
        ) : null}
      </section>

      {supportUser ? (
        <section className="card" style={{ marginTop: 18 }}>
          <div className="eyebrow">Memberships</div>
          <h3>Organization context</h3>
          {membershipsResult.error ? <div className="error">Membership context could not be loaded.</div> : null}
          <div className="list">
            {(membershipsResult.data ?? []).map((membership) => (
              <div className="item" key={membership.organization_id}>
                <strong>{membership.organization_name}</strong>
                <div className="small">/{membership.organization_slug} · role {membership.membership_role} · {Number(membership.project_count).toLocaleString()} projects</div>
                <div className="actions" style={{ marginTop: 8 }}>
                  <Link className="button" href={orgHref(membership.organization_id, exactEmail)}>Open support context</Link>
                </div>
              </div>
            ))}
            {!(membershipsResult.data ?? []).length ? <div className="notice">This account has no organization memberships.</div> : null}
          </div>
        </section>
      ) : null}

      {selectedOrganizationId ? (
        <section className="card" style={{ marginTop: 18 }}>
          <div className="eyebrow">Support cases</div>
          <h3>{selectedOrganization?.organization_name ?? "Selected organization"}</h3>
          <p className="small">
            These records are support metadata only. Creating or resolving a case does not alter account access,
            organization memberships, scientific jobs, or billing state.
          </p>
          {supportCasesResult.error ? <div className="error">Support cases could not be loaded.</div> : null}

          <form action={createPlatformSupportCase} className="card" style={{ marginTop: 12 }}>
            <input type="hidden" name="organization_id" value={selectedOrganizationId} />
            <input type="hidden" name="exact_email" value={exactEmail} />
            {supportUserMembership ? <input type="hidden" name="target_user_id" value={supportUser?.user_id ?? ""} /> : null}
            <div className="eyebrow">AAL2 required</div>
            <h3>Create support case</h3>
            <label className="small" htmlFor="support-category">Category</label>
            <select id="support-category" name="category" defaultValue="other" required>
              <option value="account">Account</option>
              <option value="access">Access</option>
              <option value="billing">Billing</option>
              <option value="scientific_job">Scientific job</option>
              <option value="other">Other</option>
            </select>
            <label className="small" htmlFor="support-title">Title</label>
            <input id="support-title" name="title" minLength={3} maxLength={160} required />
            <label className="small" htmlFor="support-note">Support note</label>
            <textarea id="support-note" name="initial_note" minLength={3} maxLength={4000} required />
            <button className="button primary" type="submit">Create audited case</button>
          </form>

          <div className="list" style={{ marginTop: 12 }}>
            {(supportCasesResult.data ?? []).map((supportCase) => (
              <div className="item" key={supportCase.support_case_id}>
                <strong>{supportCase.title}</strong>
                <div className="small">{supportCase.category.replaceAll("_", " ")} · {supportCase.status} · opened {new Date(supportCase.opened_at).toLocaleString()}</div>
                <div className="small">{supportCase.initial_note}</div>
                {supportCase.target_user_id ? <div className="small">Target user <code>{supportCase.target_user_id}</code></div> : null}
                {supportCase.target_project_id ? <div className="small">Target project <code>{supportCase.target_project_id}</code></div> : null}
                {supportCase.resolution_note ? <div className="notice">Resolution: {supportCase.resolution_note}</div> : null}
                {supportCase.status === "open" ? (
                  <form action={resolvePlatformSupportCase} style={{ marginTop: 8 }}>
                    <input type="hidden" name="support_case_id" value={supportCase.support_case_id} />
                    <input type="hidden" name="organization_id" value={selectedOrganizationId} />
                    <input type="hidden" name="exact_email" value={exactEmail} />
                    <textarea name="resolution_note" minLength={3} maxLength={4000} required placeholder="Resolution note" />
                    <button className="button" type="submit">Resolve with audit event</button>
                  </form>
                ) : null}
              </div>
            ))}
            {!(supportCasesResult.data ?? []).length ? <div className="notice">No support cases for this organization.</div> : null}
          </div>
        </section>
      ) : null}

      <section className="card" style={{ marginTop: 18 }}>
        <div className="eyebrow">Accounts</div>
        <h3>Tenant footprint</h3>
        {metricCards(overview.accounts)}
      </section>

      <section className="card" style={{ marginTop: 18 }}>
        <div className="eyebrow">Scientific resources</div>
        <h3>Recorded workload</h3>
        {metricCards(overview.scientific_resources)}
      </section>

      <section className="card" style={{ marginTop: 18 }}>
        <div className="eyebrow">AI resources</div>
        <h3>Recorded AI workload</h3>
        {metricCards(overview.ai_resources)}
      </section>

      <section className="card" style={{ marginTop: 18 }}>
        <div className="eyebrow">Worker liveness</div>
        <h3>{workers.fresh ?? 0} of {workers.expected ?? 6} workers fresh</h3>
        <p className="small">
          Missing or stale: {workers.missing_or_stale ?? 6}. Freshness threshold: {workers.stale_after_seconds ?? 300}s.
        </p>
      </section>

      <section className="card" style={{ marginTop: 18 }}>
        <div className="eyebrow">Audit</div>
        <h3>{(overview.audit_event_count ?? 0).toLocaleString()} audit events</h3>
        <p className="small">Support case create/resolve events are appended to the same hash-chained audit history.</p>
      </section>

      <section className="card" style={{ marginTop: 18 }}>
        <div className="eyebrow">Organizations</div>
        <h3>Bounded tenant summary</h3>
        <p className="small">Showing up to 50 organizations. Scientific content is not included.</p>
        <div className="list">
          {(organizationsResult.data ?? []).map((organization) => (
            <div className="item" key={organization.organization_id}>
              <strong>{organization.organization_name}</strong>
              <div className="small">/{organization.organization_slug}</div>
              <div className="small">
                {Number(organization.member_count).toLocaleString()} members · {Number(organization.project_count).toLocaleString()} projects
              </div>
              <div className="small">Created {new Date(organization.created_at).toLocaleString()}</div>
              <div className="actions" style={{ marginTop: 8 }}>
                <Link className="button" href={orgHref(organization.organization_id, exactEmail || undefined)}>Open support context</Link>
              </div>
            </div>
          ))}
          {!(organizationsResult.data ?? []).length ? <div className="notice">No organizations recorded.</div> : null}
        </div>
      </section>

      <section className="card" style={{ marginTop: 18 }}>
        <div className="eyebrow">Status distributions</div>
        <h3>Operational state counts</h3>
        <div className="list">
          {Object.entries(overview.status_counts ?? {}).map(([resource, counts]) => (
            <div className="item" key={resource}>
              <strong>{resource.replaceAll("_", " ")}</strong>
              <div className="small">
                {Object.entries(counts).length
                  ? Object.entries(counts).map(([status, count]) => `${status}: ${count}`).join(" · ")
                  : "No rows"}
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
