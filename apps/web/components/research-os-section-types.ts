export type ResearchJobView = {
  job_type: string;
  status: string;
};

export type ResearchWorkspaceViewModel = {
  organizations: number;
  projects: number;
  jobs: ResearchJobView[];
};

export function buildResearchWorkspaceViewModel(input: ResearchWorkspaceViewModel) {
  return {
    ...input,
    activeJobs: input.jobs.filter((job) => job.status === "running").length,
    completedJobs: input.jobs.filter((job) => job.status === "completed").length,
    failedJobs: input.jobs.filter((job) => job.status === "failed").length,
  };
}
