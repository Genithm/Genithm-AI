export function WorkspaceHealthIndicator() {
  const checks = [
    "Scientific runtime online",
    "Evidence pipeline configured",
    "Provenance tracking enabled",
  ];

  return (
    <section className="card futuristic-card" style={{ marginTop: 18 }}>
      <div className="eyebrow">System health</div>
      <h2>Research workspace status</h2>
      <div className="list">
        {checks.map((check) => (
          <div className="item" key={check}>
            <strong>{check}</strong>
            <div className="small">Ready</div>
          </div>
        ))}
      </div>
    </section>
  );
}
