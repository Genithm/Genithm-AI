import Link from "next/link";
import { redirect } from "next/navigation";
import { AiChatComposer,type ResearchQuickAction } from "@/components/ai-chat-composer";
import { ResearchChatSidebar } from "@/components/research-chat-sidebar";
import { GenithmToolDock } from "@/components/genithm-tool-dock";
import "@/components/genithm-research-theme.css";
import "@/components/genithm-research-fields.css";
import { createClient } from "@/lib/supabase/server";
import { scienceExecutionReady } from "@/lib/science-execution-readiness";
import { scienceV22Configured } from "@/lib/science-release";
import { createAiResearchLab,createAiResearchProject } from "./onboarding-actions";
import styles from "./chat.module.css";

const researchActions:ResearchQuickAction[]=[
  {icon:"⌘",label:"DNA & RNA",detail:"Explore an NCBI nucleotide reference",prompt:"Run ORF scan on NM_000546.6",needsWorkers:true},
  {icon:"◈",label:"Proteins",detail:"Calculate protein properties",prompt:"Calculate protein properties for NP_000537.3",needsWorkers:true},
  {icon:"⇄",label:"Compare sequences",detail:"Choose an alignment approach",prompt:"Help me align two sequences from my research project and interpret the important differences."},
  {icon:"◎",label:"Find similar sequences",detail:"Plan a BLAST search",prompt:"I want to run BLAST on a FASTA sequence. Guide me through a scientific search and explain the resulting hits."},
  {icon:"♧",label:"Phylogenetics",detail:"Plan alignment and tree analysis",prompt:"Plan a multiple sequence alignment and a phylogenetic tree for my sequences."},
  {icon:"✳",label:"Plan my research",detail:"Start with your biological question",prompt:"Help me design a rigorous, reproducible bioinformatics workflow for my biological research question."},
];

export default async function AiWorkspacePage({searchParams}:{searchParams:Promise<{error?:string;project?:string}>}) {
  const query=await searchParams;
  const supabase=await createClient();
  const {data:claims,error:authError}=await supabase.auth.getClaims();
  if (!claims?.claims?.sub) redirect("/login");
  if (authError) redirect("/login");
  const [{data:projects,error:projectsError},{data:conversations,error:conversationsError},{data:organizations,error:labsError}]=await Promise.all([
    supabase.from("projects").select("id,name,status,created_at").eq("status","active").order("created_at",{ascending:false}).limit(100),
    supabase.from("ai_conversations").select("id,project_id,title,status,created_at,updated_at").eq("created_by",claims.claims.sub).order("updated_at",{ascending:false}).limit(50),
    supabase.from("organizations").select("id,name").order("created_at",{ascending:true}).limit(50),
  ]);
  const activeProjects=projects??[];
  const labs=organizations??[];
  const projectNames=Object.fromEntries(activeProjects.map(project=>[project.id,project.name]));
  const selectedProject=query.project ? activeProjects.find(project=>project.id===query.project) : activeProjects[0];
  const invalidProject=Boolean(query.project&&!selectedProject);
  const {data:recentRuns,error:recentRunsError}=!projectsError&&activeProjects.length
    ?await supabase.from("scientific_jobs").select("id,job_type,status,created_at,result_sha256")
      .eq("requested_by", claims.claims.sub).in("project_id",activeProjects.map(project=>project.id))
      .order("created_at",{ascending:false}).limit(4)
    :{data:[],error:null};
  const fixedScienceReady=scienceV22Configured()&&await scienceExecutionReady();
  const scienceUnavailable = !fixedScienceReady;
  return <main className={styles.shell} aria-label="Genithm AI research chat">
    <ResearchChatSidebar conversations={conversations??[]} projectNames={projectNames} projectCount={activeProjects.length}/>
    <section className={styles.main}>
      <div className={styles.topBar}><div className={styles.workspaceIdentity}><strong>AI Chat</strong><span className={styles.beta}>Private workspace</span></div><Link href="/dashboard/ai/research" className={styles.topLink}>Research history</Link></div>
      <div className={styles.content}>
        <div className={styles.hero}><div className={styles.heroSymbol}><img src="/genithm-logo.webp" alt="" width={64} height={64}/></div><div className={styles.heroEyebrow}>YOUR BIOINFORMATICS ASSISTANT</div><h1>What would you like to analyze?</h1><p>Ask a question, bring your sequences, or plan your next analysis.</p></div>
        {query.error?<div className={"error "+styles.feedback} role="alert">{query.error.slice(0,500)}</div>:null}
        {conversationsError?<p role="alert" className="error">Recent conversations could not be loaded.</p>:null}
        {projectsError||labsError?<p role="alert" className="error">Workspace access could not be loaded. Refresh before creating a project or starting an analysis.</p>:invalidProject?<p role="alert" className="error">That project is not available. <Link href="/dashboard/projects">Choose an accessible project.</Link></p>:activeProjects.length?<>
          <AiChatComposer projects={activeProjects.map(project=>({id:project.id,name:project.name}))} defaultProjectId={selectedProject?.id} placeholder="Ask Genithm about your data, or describe an analysis..." quickActions={[researchActions[5],researchActions[2],researchActions[3]]} scienceReady={fixedScienceReady}/>
          <div className={styles.availability} role="status"><span className={scienceUnavailable?styles.availabilityDot:styles.readyDot} aria-hidden="true"/><div><strong>{scienceUnavailable?"Scientific execution is currently unavailable":"Scientific workers available"}</strong><span>{scienceUnavailable?"You can still chat and plan. Worker-backed analyses need the scientific services to be running.":"You approve scientific work before it runs."}</span></div></div>
        </>:<div className={styles.onboarding}>
          <div className={styles.onboardingIntro}><span className={styles.stepPill}>LET'S GET STARTED</span><h2>Create your research space</h2><p>Keep your questions, data, and results together in a project.</p></div>
          {!labs.length?<form action={createAiResearchLab} className={styles.setupForm}><label htmlFor="genithm-lab">Lab or team name</label><div className={styles.setupRow}><input id="genithm-lab" name="name" minLength={2} maxLength={100} placeholder="My research lab" autoComplete="organization" required/><button className="button primary" type="submit">Create lab</button></div></form>:<form action={createAiResearchProject} className={styles.setupForm}><label htmlFor="genithm-org">Research team</label><select id="genithm-org" name="organization_id" required>{labs.map(lab=><option key={lab.id} value={lab.id}>{lab.name}</option>)}</select><label htmlFor="genithm-project">Project name</label><div className={styles.setupRow}><input id="genithm-project" name="name" minLength={2} maxLength={160} placeholder="My first study" required/><button className="button primary" type="submit">Create project</button></div></form>}
          <p className={styles.setupFoot}>Scientific execution always needs your approval.</p>
        </div>}
        <div className={styles.bottomCaption}>Review AI explanations and the recorded evidence before drawing scientific conclusions.</div>
      </div>
    </section>
    <GenithmToolDock projectCount={activeProjects.length} scienceReady={fixedScienceReady} recentRuns={recentRuns??[]} recentRunsError={Boolean(projectsError||recentRunsError)}/>
  </main>;
}
