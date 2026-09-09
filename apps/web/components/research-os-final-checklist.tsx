export function ResearchOsFinalChecklist() {
  const checks = [
    "Research OS layout composed",
    "Dashboard migration path prepared",
    "Scientific workflow presentation ready",
    "Evidence and reporting layers connected",
    "Launch validation layer available",
  ];

  return (
    <section className="card futuristic-card" style={{ marginTop: 18 }}>
      <div className="eyebrow">Final checklist</div>
      <h2>Genithm V1 workspace validation</h2>
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
