import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import styles from "./studies.module.css";

export const dynamic = "force-dynamic";

type StudiesFilter = { project?: string; kind?: string; error?: string; deleted?: string };
const allowedKinds = ["protein_properties", "pairwise_alignment"];

export default async function SavedScientificStudiesPage({
  searchParams,
}: { searchParams: Promise<StudiesFilter> }) {
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId || authError) redirect("/login");

  const params = await searchParams;
  const { data: projects, error: projectsError } = await supabase.from("projects")
    .select("id,name").eq("status","active").order("name",{ascending:true}).limit(200);
  const names = new Map((projects ?? []).map(project => [project.id,project.name]));
  const chosenProject = params.project || "";
  const chosenKind = params.kind || "";
  const invalid = Boolean(chosenProject && !names.has(chosenProject)) ||
    Boolean(chosenKind && !allowedKinds.includes(chosenKind));
  const allowed = !invalid && !projectsError && (projects ?? []).length > 0;
  let query = supabase.from("scientific_comparison_studies")
    .select("id,title,description,project_id,job_type,job_ids,created_at,updated_at")
    .eq("created_by",userId).order("created_at",{ascending:false}).limit(100);
  if (chosenProject) query = query.eq("project_id",chosenProject);
  else if (allowed) query = query.in("project_id",(projects ?? []).map(project=>project.id));
  if (!invalid && chosenKind) query = query.eq("job_type", chosenKind as "protein_properties" | "pairwise_alignment");
  const { data: studies, error: studiesError } = allowed
    ? await query : { data: [], error: null };
  const failed = Boolean(projectsError || studiesError || invalid);

  return (
    <main className={styles.shell}>
      <nav className={styles.navigation} aria-label="Study navigation">
        <Link href="/dashboard/results">← Scientific results</Link>
        <Link href="/dashboard/ai">Genithm chat</Link>
        <Link href="/dashboard/notebook">Research notebook</Link>
      </nav>
      <header className={styles.hero}>
        <span className={styles.kicker}>GENITHM · SAVED RESEARCH COMPARISONS</span>
        <h1>Your comparison studies</h1>
        <p>Return to carefully selected scientific runs. Source fingerprints and tool versions are preserved, while every reopening performs fresh artifact verification.</p>
        <Link className={styles.primary} href="/dashboard/results">＋ Start a comparison</Link>
      </header>
      {params.deleted ? <p role="status" className={styles.success}>Study removed from your library. The original scientific jobs were not changed.</p> : null}
      {params.error ? <p role="alert" className={styles.error}>{params.error.slice(0,200)}</p> : null}
      {failed ? <p role="alert" className={styles.error}>The requested studies or filters are unavailable. No records have been inferred.</p> : null}
      <form action="/dashboard/results/studies" method="get" className={styles.filters}>
        <label>Project
          <select name="project" defaultValue={chosenProject}>
            <option value="">All accessible projects</option>
            {(projects ?? []).map(project=><option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
        </label>
        <label>Analysis
          <select name="kind" defaultValue={chosenKind}>
            <option value="">All supported types</option>
            <option value="protein_properties">Protein properties</option>
            <option value="pairwise_alignment">Pairwise alignment</option>
          </select>
        </label>
        <button type="submit">Filter</button>
        <Link href="/dashboard/results/studies">Reset</Link>
      </form>
      <section className={styles.cards} aria-label="Saved scientific studies">
        {!failed && (studies ?? []).map(study=>(
          <article key={study.id} className={styles.card}>
            <div className={styles.cardMeta}>
              <span>{study.job_type.replaceAll("_"," ")}</span>
              <span>{study.job_ids.length} source runs</span>
            </div>
            <h2>{study.title}</h2>
            {study.description ? <p>{study.description}</p> : <p>Saved scientific result comparison.</p>}
            <div className={styles.cardFoot}>
              <span>{names.get(study.project_id) ?? "Accessible project"} · {new Date(study.created_at).toLocaleDateString("en",{timeZone:"UTC"})} UTC</span>
              <Link href={"/dashboard/results/studies/"+study.id}>Reopen verified study →</Link>
            </div>
          </article>
        ))}
        {!failed && !(studies ?? []).length ? <div className={styles.empty}>
          No saved studies yet. Compare two to four completed runs in Scientific Results and choose “Save study” after verification.
        </div> : null}
      </section>
      <p className={styles.disclaimer}>Showing up to 100 recent saved studies. Stored hashes attest to recorded job metadata; integrity is verified anew when a study is opened.</p>
    </main>
  );
}
