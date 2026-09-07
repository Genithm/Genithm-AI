import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { createOrganization, createProject } from "./actions";

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) redirect("/login");

  const [{ data: organizations }, { data: projects }] = await Promise.all([
    supabase.from("organizations").select("id,name,slug,created_at").order("created_at", { ascending: true }),
    supabase.from("projects").select("id,organization_id,name,description,status,created_at").order("created_at", { ascending: false }),
  ]);

  return (
    <main className="container dashboard">
      <header className="dashboard-header">
        <div>
          <div className="eyebrow">Secure workspace</div>
          <h2>Research dashboard</h2>
          <p className="small">Signed in as {String(claimsData.claims.email ?? userId)}</p>
        </div>
        <form action="/auth/signout" method="post"><button className="button">Sign out</button></form>
      </header>
      {params.error ? <p className="error">{params.error}</p> : null}
      <div className="section-grid">
        <section className="card">
          <h2>Organizations</h2>
          <form className="stack" action={createOrganization}>
            <label>Name<input name="name" minLength={2} maxLength={100} required /></label>
            <label>Slug (optional)<input name="slug" maxLength={63} placeholder="my-lab" /></label>
            <button className="button primary">Create organization</button>
          </form>
          <div className="list" style={{ marginTop: 18 }}>
            {(organizations ?? []).map((org) => <div className="item" key={org.id}><strong>{org.name}</strong><div className="small">{org.slug}</div></div>)}
            {!organizations?.length ? <p>No organization yet.</p> : null}
          </div>
        </section>
        <section className="card">
          <h2>Projects</h2>
          {organizations?.length ? (
            <form className="stack" action={createProject}>
              <label>Organization
                <select name="organization_id" required style={{ padding: 12, borderRadius: 10, background: "#07151a", color: "inherit", border: "1px solid var(--line)" }}>
                  {organizations.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}
                </select>
              </label>
              <label>Project name<input name="name" maxLength={160} required /></label>
              <label>Description<textarea name="description" maxLength={5000} /></label>
              <button className="button primary">Create project</button>
            </form>
          ) : <div className="notice">Create an organization first.</div>}
          <div className="list" style={{ marginTop: 18 }}>
            {(projects ?? []).map((project) => <div className="item" key={project.id}><strong>{project.name}</strong><div className="small">{project.status}</div>{project.description ? <p>{project.description}</p> : null}</div>)}
            {!projects?.length ? <p>No projects yet.</p> : null}
          </div>
        </section>
      </div>
    </main>
  );
}
