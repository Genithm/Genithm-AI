export function ResearchOsMigrationChecklist() {
  const items = [
    "Research OS shell connected",
    "Scientific jobs mapped to dashboard views",
    "Evidence and provenance layers ready",
    "Legacy workflow sections preserved during migration",
  ];

  return (
    <section className="card futuristic-card" style={{ marginTop: 18 }}>
      <div className="eyebrow">Migration status</div>
      <h2>Research OS rollout checklist</h2>
      <div className="list">
        {items.map((item) => (
          <div className="item" key={item}>
            <strong>{item}</strong>
            <div className="small">Prepared</div>
          </div>
        ))}
      </div>
    </section>
  );
}
