import { ResearchOsLiveSection } from "./research-os-live-section";
import type { ResearchJobView } from "./research-os-section-types";

export function ResearchOsDashboardAdapter({
  organizations,
  projects,
  jobs,
}: {
  organizations: number;
  projects: number;
  jobs: ResearchJobView[];
}) {
  return (
    <ResearchOsLiveSection
      organizations={organizations}
      projects={projects}
      jobs={jobs}
    />
  );
}
