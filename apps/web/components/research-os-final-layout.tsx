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
      <ResearchOsDashboardSlot
        organizations={organizations}
        projects={projects}
        jobs={jobs}
      />
      <ResearchOsMigrationChecklist />
    </>
  );
}
