import Link from "next/link";
import {redirect} from "next/navigation";
import {createClient} from "@/lib/supabase/server";
import {GenithmIcon} from "@/components/genithm-icon";
import {createAiResearchLab,createAiResearchProject} from "../ai/onboarding-actions";
export const dynamic="force-dynamic";
export default async function ProjectsPage(){
  const db=await createClient();const {data:auth,error:authError}=await db.auth.getClaims();
  if(authError||!auth?.claims?.sub)redirect("/login");
  const [{data:projects,error},{data:labs,error:labError}]=await Promise.all([
    db.from("projects").select("id,name,description,status,created_at").eq("status","active").order("created_at",{ascending:false}).limit(100),
    db.from("organizations").select("id,name").order("name",{ascending:true}).limit(100),
  ]);
  return <main className="genithm-page"><header className="genithm-page-heading"><div><div className="genithm-page-kicker">YOUR WORKSPACE</div><h1>Projects</h1><p>A place for each research question, its data, and its results.</p></div><Link className="button" href="/dashboard/results">View results</Link></header>
    {error||labError?<p role="alert" className="error">Projects could not be loaded securely. Please refresh.</p>:<>
      <details className="genithm-disclosure"><summary>Create a project</summary>{labs?.length?<form action={createAiResearchProject} className="genithm-form"><label>Research team<select name="organization_id" required>{labs.map(lab=><option key={lab.id} value={lab.id}>{lab.name}</option>)}</select></label><label>Project name<input name="name" minLength={2} maxLength={160} placeholder="Name your study" required/></label><button className="button primary" type="submit">Create project</button></form>:<form action={createAiResearchLab} className="genithm-form"><p>First, create your research team.</p><label>Lab or team name<input name="name" minLength={2} maxLength={100} required/></label><button type="submit" className="button primary">Create lab</button></form>}</details>
      <div className="genithm-card-grid">{projects?.map(project=><article className="genithm-card" key={project.id}><span className="genithm-card-icon"><GenithmIcon name="projects"/></span><h2>{project.name}</h2><p>{project.description||"A private space for your biological research."}</p><span className="genithm-state">Active project</span><Link className="genithm-card-link" href={"/dashboard/ai?project="+encodeURIComponent(project.id)}>Open in AI Chat <GenithmIcon name="arrow" size={16}/></Link><div className="genithm-page-links"><Link href={"/dashboard/results?project="+project.id}>Results</Link><Link href={"/dashboard/notebook?project="+project.id}>Notebook</Link></div></article>)}</div>
      {!projects?.length?<div className="genithm-empty">No active projects yet. Create one above to get started.</div>:null}
      <p className="genithm-note">Showing up to 100 active projects available to your account. Creating a project returns you to AI Chat.</p>
    </>}
  </main>;
}
