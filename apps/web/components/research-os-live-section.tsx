import { ResearchOsOverview } from "./research-os-overview";
import { ResearchActivityFeed } from "./research-activity-feed";

export function ResearchOsLiveSection({
  organizations,
  projects,
  jobs,
}: {
  organizations: number;
  projects: number;
  jobs: Array<{ job_type: string; status: string }>;
}) {
  const activities = jobs.slice(0, 10).map((job) => ({
    title: job.job_type.replaceAll("_", " "),
    detail: job.status.replaceAll("_", " "),
  }));

  return (
    <>
      <ResearchOsOverview
        organizations={organizations}
        projects={projects}
        jobs={jobs}
      />
      <ResearchActivityFeed activities={activities} />
    </>
  );
}
