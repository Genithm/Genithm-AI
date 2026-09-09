export function ResearchOsIntegrationStatus() {
  const items = [
    "Dashboard migration boundary active",
    "Research workspace modules connected",
    "Scientific data adapters prepared",
    "V1 UI transition path ready",
  ];

  return (
    <section className="card futuristic-card" style={{ marginTop: 18 }}>
      <div className="eyebrow">Integration status</div>
      <h2>Research OS integration</h2>
      <div className="list">
        {items.map((item) => (
          <div className="item" key={item}>
            <strong>{item}</strong>
            <div className="small">Ready</div>
          </div>
        ))}
      </div>
    </section>
  );
}
