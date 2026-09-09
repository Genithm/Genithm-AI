export type ResearchJobStatus = {
  job_type: string;
  status: string;
};

export function summarizeResearchJobs(jobs: ResearchJobStatus[]) {
  return {
    total: jobs.length,
    running: jobs.filter((job) => job.status === "running").length,
    completed: jobs.filter((job) => job.status === "completed").length,
    failed: jobs.filter((job) => job.status === "failed").length,
  };
}

export function formatResearchLabel(value: string) {
  return value.replaceAll("_", " ");
}
