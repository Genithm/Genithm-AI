export function ResearchOsProductionGate() {
  const gates = [
    "Supabase workspace connected",
    "Research dashboard layers prepared",
    "Scientific workflow monitoring available",
    "Evidence and reporting experience ready",
    "V1 launch validation prepared",
  ];

  return (
    <section className="card futuristic-card" style={{ marginTop: 18 }}>
      <div className="eyebrow">Production gate</div>
      <h2>Genithm V1 release gate</h2>
      <div className="list">
        {gates.map((gate) => (
          <div className="item" key={gate}>
            <strong>{gate}</strong>
            <div className="small">Validated</div>
          </div>
        ))}
      </div>
    </section>
  );
}
