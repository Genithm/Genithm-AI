export function ResearchOsReleaseSummary() {
  const items = [
    "Research workspace UI integrated",
    "Scientific workflow monitoring ready",
    "Evidence and provenance views prepared",
    "V1 release presentation layer complete",
  ];

  return (
    <section className="card futuristic-card" style={{ marginTop: 18 }}>
      <div className="eyebrow">Release overview</div>
      <h2>Genithm V1 Research OS</h2>
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
