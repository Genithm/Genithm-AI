export function ResearchOsIntegrationSummary() {
  const layers = [
    "Dashboard data layer connected",
    "Research OS UI composition ready",
    "Scientific workflow views prepared",
    "Evidence and report presentation ready",
  ];

  return (
    <section className="card futuristic-card" style={{ marginTop: 18 }}>
      <div className="eyebrow">Final integration</div>
      <h2>Research OS platform layers</h2>
      <div className="list">
        {layers.map((layer) => (
          <div className="item" key={layer}>
            <strong>{layer}</strong>
            <div className="small">Ready</div>
          </div>
        ))}
      </div>
    </section>
  );
}
