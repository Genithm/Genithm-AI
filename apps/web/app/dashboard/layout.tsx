import Link from "next/link";

import { createClient } from "@/lib/supabase/server";

export default async function DashboardLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const supabase = await createClient();
  const [{ data: claimsData }, { data: isPlatformAdmin }] = await Promise.all([
    supabase.auth.getClaims(),
    supabase.rpc("is_platform_admin"),
  ]);

  const email = String(claimsData?.claims?.email ?? "Researcher");

  return (
    <>
      <div className="dashboard-shell">
        <div className="dashboard-shell-inner">
          <Link className="dashboard-brand" href="/dashboard" aria-label="Genithm dashboard">
            <span className="dashboard-brand-mark" aria-hidden="true">G</span>
            <span>
              <strong>Genithm</strong>
              <small>Research workspace</small>
            </span>
          </Link>

          <nav className="dashboard-nav" aria-label="Workspace navigation">
            <Link href="/dashboard">Workspace</Link>
            <Link href="/dashboard/ai">AI</Link>
            <Link href="/dashboard/reports">Reports</Link>
            <Link href="/dashboard/billing">Plan & usage</Link>
            <Link href="/dashboard/billing/payments">Payments</Link>
            {isPlatformAdmin ? <Link href="/dashboard/admin">Admin</Link> : null}
          </nav>

          <div className="dashboard-account">
            <span className="dashboard-account-copy">
              <strong>Secure session</strong>
              <small>{email}</small>
            </span>
            <form action="/auth/signout" method="post">
              <button className="button compact" type="submit">Sign out</button>
            </form>
          </div>
        </div>

        {isPlatformAdmin ? (
          <nav className="dashboard-admin-nav" aria-label="Platform administration">
            <span>Platform administration</span>
            <Link href="/dashboard/admin/billing">Billing operations</Link>
            <Link href="/dashboard/admin/billing/payments">Payment operations</Link>
            <Link href="/dashboard/admin/billing/payments/setup">Payment setup</Link>
          </nav>
        ) : null}
      </div>
      {children}
    </>
  );
}
