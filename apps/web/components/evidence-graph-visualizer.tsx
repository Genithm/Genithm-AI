export function EvidenceGraphVisualizer({
  nodes,
}: {
  nodes: Array<{ label: string; type: string }>;
}) {
  return (
    <section className="card futuristic-card" style={{ marginTop: 18 }}>
      <div className="eyebrow">Evidence graph</div>
      <h2>Reproducibility map</h2>
      <p>
        Visual layer for connecting inputs, scientific tools, results, and
        provenance records into a traceable research graph.
      </p>
      <div className="list">
        {nodes.length ? nodes.map((node, index) => (
          <div className="item" key={`${node.label}-${index}`}>
            <strong>{node.label}</strong>
            <div className="small">{node.type}</div>
          </div>
        )) : (
          <div className="notice">Evidence graph will populate after analyses complete.</div>
        )}
      </div>
    </section>
  );
}
