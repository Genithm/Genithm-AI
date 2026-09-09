import { ResearchWorkspaceShell } from "./research-workspace-shell";

export function ResearchWorkspaceData({
  jobs,
}: {
  jobs: Array<{
    job_type: string;
    status: string;
  }>;
}) {
  const timeline = jobs.slice(0, 8).map((job) => ({
    label: job.job_type.replaceAll("_", " "),
    status: job.status.replaceAll("_", " "),
  }));

  const evidence = jobs.slice(0, 8).map((job) => ({
    label: job.job_type.replaceAll("_", " "),
    type: "scientific execution",
  }));

  return (
    <ResearchWorkspaceShell
      activeJobs={jobs.filter((job) => job.status === "running").length}
      completed={jobs.filter((job) => job.status === "completed").length}
      timeline={timeline}
      evidence={evidence}
    />
  );
}
