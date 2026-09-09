export function ResearchDataBindingSummary({
  organizations,
  projects,
  jobs,
}: {
  organizations: number;
  projects: number;
  jobs: Array<{ job_type: string; status: string }>;
}) {
  const active = jobs.filter((job) => job.status === "running").length;
  const completed = jobs.filter((job) => job.status === "completed").length;

  return (
    <section className="card futuristic-card" style={{ marginTop: 18 }}>
      <div className="eyebrow">Live data layer</div>
      <h2>Research workspace intelligence</h2>
      <div className="grid">
        <div className="item">
          <div className="small">Organizations</div>
          <strong>{organizations}</strong>
        </div>
        <div className="item">
          <div className="small">Projects</div>
          <strong>{projects}</strong>
        </div>
        <div className="item">
          <div className="small">Running / Completed</div>
          <strong>{active} / {completed}</strong>
        </div>
      </div>
    </section>
  );
}
