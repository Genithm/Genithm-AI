import { ResearchOsDashboardAdapter } from "./research-os-dashboard-adapter";
import type { ResearchJobView } from "./research-os-section-types";

export function ResearchOsDashboardSlot({
  organizations,
  projects,
  jobs,
}: {
  organizations: number;
  projects: number;
  jobs: ResearchJobView[];
}) {
  return (
    <div>
      <ResearchOsDashboardAdapter
        organizations={organizations}
        projects={projects}
        jobs={jobs}
      />
    </div>
  );
}
