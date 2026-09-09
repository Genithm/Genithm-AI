export function EvidenceReportPanel({
  title = "Evidence report",
  items = [],
}: {
  title?: string;
  items?: Array<{ label: string; value: string }>;
}) {
  return (
    <section className="card futuristic-card" style={{ marginTop: 18 }}>
      <div className="eyebrow">Provenance layer</div>
      <h2>{title}</h2>
      <p>
        Scientific outputs are presented with traceable evidence, execution
        context, and reproducibility metadata.
      </p>
      <div className="list">
        {items.length ? (
          items.map((item) => (
            <div className="item" key={item.label}>
              <strong>{item.label}</strong>
              <div className="small">{item.value}</div>
            </div>
          ))
        ) : (
          <div className="notice">Evidence will appear after analysis completion.</div>
        )}
      </div>
    </section>
  );
}
