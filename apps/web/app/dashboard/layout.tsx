import Link from "next/link";

import { createClient } from "@/lib/supabase/server";

export default async function DashboardLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const supabase = await createClient();
  const { data: isPlatformAdmin } = await supabase.rpc("is_platform_admin");

  return (
    <>
      <div className="container" style={{ paddingTop: 18 }}>
        <nav className="actions" aria-label="Workspace navigation" style={{ marginTop: 0 }}>
          <Link className="button" href="/dashboard">Research dashboard</Link>
          <Link className="button" href="/dashboard/ai">Genithm AI</Link>
          <Link className="button" href="/dashboard/reports">Scientific reports</Link>
          {isPlatformAdmin ? <Link className="button" href="/dashboard/admin">Platform admin</Link> : null}
        </nav>
      </div>
      {children}
    </>
  );
}
