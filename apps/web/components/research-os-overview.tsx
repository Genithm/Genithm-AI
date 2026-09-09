import { DashboardModuleIndex } from "./dashboard-module-index";
import { ResearchDataBindingSummary } from "./research-data-binding-summary";
import { ScientificWorkflowStatusPanel } from "./scientific-workflow-status-panel";

export function ResearchOsOverview({
  organizations,
  projects,
  jobs,
}: {
  organizations: number;
  projects: number;
  jobs: Array<{ job_type: string; status: string }>;
}) {
  const running = jobs.filter((job) => job.status === "running").length;
  const completed = jobs.filter((job) => job.status === "completed").length;
  const failed = jobs.filter((job) => job.status === "failed").length;

  return (
    <>
      <DashboardModuleIndex
        organizations={organizations}
        projects={projects}
        analyses={jobs.length}
      />
      <ResearchDataBindingSummary
        organizations={organizations}
        projects={projects}
        jobs={jobs}
      />
      <ScientificWorkflowStatusPanel
        running={running}
        completed={completed}
        failed={failed}
      />
    </>
  );
}
