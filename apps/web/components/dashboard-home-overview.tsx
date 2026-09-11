"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import styles from "./dashboard-home-overview.module.css";

type DashboardSnapshot = {
  organizations: number;
  projects: number;
  readyInputs: number;
  activeJobs: number;
  completedJobs: number;
};

const terminalStatuses = new Set(["completed", "failed", "cancelled", "canceled"]);

function scrollToHeading(heading: string) {
  const headings = Array.from(document.querySelectorAll<HTMLElement>("main.dashboard h2"));
  const target = headings.find((element) => element.textContent?.trim() === heading);
  const section = target?.closest<HTMLElement>("section.card") ?? target;
  section?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function DashboardHomeOverview() {
  const pathname = usePathname();
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    if (pathname !== "/dashboard") return;

    let cancelled = false;
    const supabase = createClient();

    async function loadSnapshot() {
      const [organizations, projects, readyInputs, recentJobs] = await Promise.all([
        supabase.from("organizations").select("id", { count: "exact", head: true }),
        supabase.from("projects").select("id", { count: "exact", head: true }),
        supabase.from("sequence_uploads").select("id", { count: "exact", head: true }).eq("status", "ready"),
        supabase.from("scientific_jobs").select("status").order("created_at", { ascending: false }).limit(50),
      ]);

      if (cancelled) return;
      if (organizations.error || projects.error || readyInputs.error || recentJobs.error) {
        setLoadError(true);
        return;
      }

      const statuses = (recentJobs.data ?? []).map((job) => String(job.status ?? ""));
      setSnapshot({
        organizations: organizations.count ?? 0,
        projects: projects.count ?? 0,
        readyInputs: readyInputs.count ?? 0,
        activeJobs: statuses.filter((status) => status && !terminalStatuses.has(status)).length,
        completedJobs: statuses.filter((status) => status === "completed").length,
      });
      setLoadError(false);
    }

    void loadSnapshot();
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  const recommendation = useMemo(() => {
    if (!snapshot) return { title: "Preparing your workspace", copy: "Loading your current research state.", heading: "Organizations", action: "Open setup" };
    if (snapshot.organizations === 0) return { title: "Create your research organization", copy: "Start with the lab or team boundary that will own projects and data.", heading: "Organizations", action: "Create organization" };
    if (snapshot.projects === 0) return { title: "Create your first project", copy: "Projects keep sequence inputs, analyses, and evidence grouped into a reproducible research unit.", heading: "Organizations", action: "Create project" };
    if (snapshot.readyInputs === 0) return { title: "Add a validated sequence", copy: "Upload a private FASTA or retrieve a current source record before running scientific analyses.", heading: "Private FASTA inputs", action: "Add sequence" };
    if (snapshot.activeJobs > 0) return { title: "Review active scientific work", copy: `${snapshot.activeJobs} job${snapshot.activeJobs === 1 ? " is" : "s are"} currently queued or executing.`, heading: "Recent scientific analyses", action: "Review jobs" };
    return { title: "Launch the next analysis", copy: "Validated inputs are ready. Choose an analysis and Genithm will preserve tool versions, hashes, and provenance.", heading: "Alignment workflows", action: "Choose analysis" };
  }, [snapshot]);

  if (pathname !== "/dashboard") return null;

  return (
    <section className={`container dashboard-home-overview ${styles.overview}`} aria-labelledby="workspace-overview-title">
      <div className={styles.hero}>
        <div>
          <div className="workspace-kicker"><span className="workspace-status-dot" /> Research workspace</div>
          <h1 className={styles.title} id="workspace-overview-title">Your scientific work, at a glance.</h1>
          <p className={styles.summary}>Track validated inputs and scientific execution before moving into the detailed workflow below. Genithm keeps deterministic tools, evidence, and provenance attached to every result.</p>
        </div>
        <div className={styles.nextAction}>
          <span className={styles.nextLabel}>Recommended next step</span>
          <strong>{recommendation.title}</strong>
          <p>{recommendation.copy}</p>
          <button className="button primary" type="button" onClick={() => scrollToHeading(recommendation.heading)}>{recommendation.action}</button>
        </div>
      </div>

      <div className={styles.metrics} aria-label="Workspace summary">
        <article className={styles.metric}><span>Projects</span><strong>{snapshot?.projects ?? "—"}</strong><small>Current research workspaces</small></article>
        <article className={styles.metric}><span>Ready inputs</span><strong>{snapshot?.readyInputs ?? "—"}</strong><small>Validated sequence records</small></article>
        <article className={styles.metric}><span>Active jobs</span><strong>{snapshot?.activeJobs ?? "—"}</strong><small>Queued or executing</small></article>
        <article className={styles.metric}><span>Completed</span><strong>{snapshot?.completedJobs ?? "—"}</strong><small>Recent scientific jobs</small></article>
      </div>

      {loadError ? <div className={styles.loadNotice}>Workspace summary could not be refreshed. The scientific workflows below remain available.</div> : null}
    </section>
  );
}
