export function ResearchCommandCenter({
  activeJobs,
  completed,
}: {
  activeJobs: number;
  completed: number;
}) {
  return (
    <section className="card futuristic-card" style={{ marginTop: 18 }}>
      <div className="eyebrow">Research command center</div>
      <h2>Scientific intelligence overview</h2>
      <p>
        Monitor active computational workflows, validated evidence, and completed
        analyses from one research operations layer.
      </p>
      <div className="grid">
        <div className="item">
          <div className="small">Active workflows</div>
          <strong>{activeJobs}</strong>
        </div>
        <div className="item">
          <div className="small">Completed analyses</div>
          <strong>{completed}</strong>
        </div>
        <div className="item">
          <div className="small">Evidence status</div>
          <strong>Verified pipeline</strong>
        </div>
      </div>
    </section>
  );
}
