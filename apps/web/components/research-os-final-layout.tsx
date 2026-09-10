import { ResearchOsDashboardSlot } from "./research-os-dashboard-slot";
import { ResearchOsMigrationChecklist } from "./research-os-migration-checklist";

import type { ResearchJobView } from "./research-os-section-types";

export function ResearchOsFinalLayout({
  organizations,
  projects,
  jobs,
}: {
  organizations: number;
  projects: number;
  jobs: ResearchJobView[];
}) {
  return (
    <>
      <section className="card" style={{ marginBottom: 18 }}>
        <div className="eyebrow">Genithm Research OS</div>
        <h2>Research command center</h2>
        <p className="small">
          Unified scientific workspace for projects, workflows, evidence and AI-assisted research.
        </p>
        <div className="section-grid">
          <div className="item"><strong>{organizations}</strong><div className="small">Organizations</div></div>
          <div className="item"><strong>{projects}</strong><div className="small">Projects</div></div>
          <div className="item"><strong>{jobs.filter((job) => job.status === "running").length}</strong><div className="small">Running workflows</div></div>
          <div className="item"><strong>{jobs.filter((job) => job.status === "completed").length}</strong><div className="small">Completed analyses</div></div>
        </div>
      </section>
      <ResearchOsDashboardSlot organizations={organizations} projects={projects} jobs={jobs} />
      <ResearchOsMigrationChecklist />
    </>
  );
}
