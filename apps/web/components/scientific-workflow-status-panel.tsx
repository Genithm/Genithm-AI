export function ScientificWorkflowStatusPanel({
  running,
  completed,
  failed,
}: {
  running: number;
  completed: number;
  failed: number;
}) {
  return (
    <section className="card futuristic-card" style={{ marginTop: 18 }}>
      <div className="eyebrow">Workflow status</div>
      <h2>Scientific execution monitor</h2>
      <div className="grid">
        <div className="item">
          <div className="small">Running</div>
          <strong>{running}</strong>
        </div>
        <div className="item">
          <div className="small">Completed</div>
          <strong>{completed}</strong>
        </div>
        <div className="item">
          <div className="small">Failed</div>
          <strong>{failed}</strong>
        </div>
      </div>
    </section>
  );
}
