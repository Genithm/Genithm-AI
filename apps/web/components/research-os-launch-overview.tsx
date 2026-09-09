export function ResearchOsLaunchOverview() {
  const items = [
    "Genithm Research OS interface prepared",
    "Scientific workflow monitoring available",
    "Evidence and reporting layers available",
    "Production validation flow prepared",
  ];

  return (
    <section className="card futuristic-card" style={{ marginTop: 18 }}>
      <div className="eyebrow">Launch overview</div>
      <h2>Genithm V1 Research Platform</h2>
      <div className="list">
        {items.map((item) => (
          <div className="item" key={item}>
            <strong>{item}</strong>
            <div className="small">Complete</div>
          </div>
        ))}
      </div>
    </section>
  );
}
