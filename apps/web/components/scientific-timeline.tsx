export function ScientificTimeline({
  jobs,
}: {
  jobs: Array<{ label: string; status: string }>;
}) {
  return (
    <section className="card futuristic-card" style={{ marginTop: 18 }}>
      <div className="eyebrow">Execution timeline</div>
      <h2>Scientific workflow activity</h2>
      <div className="list">
        {jobs.length ? jobs.map((job, index) => (
          <div className="item" key={`${job.label}-${index}`}>
            <strong>{job.label}</strong>
            <div className="small">Status: {job.status}</div>
          </div>
        )) : (
          <div className="notice">No active scientific workflows.</div>
        )}
      </div>
    </section>
  );
}
