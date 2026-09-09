export function ScientificEvidenceSummary({
  tool,
  provenance,
  evidence,
}: {
  tool: string;
  provenance: string;
  evidence: string;
}) {
  return (
    <section className="card futuristic-card" style={{ marginTop: 18 }}>
      <div className="eyebrow">Evidence layer</div>
      <h2>Scientific traceability</h2>
      <div className="list">
        <div className="item">
          <strong>Tool execution</strong>
          <div className="small">{tool}</div>
        </div>
        <div className="item">
          <strong>Provenance</strong>
          <div className="small">{provenance}</div>
        </div>
        <div className="item">
          <strong>Evidence</strong>
          <div className="small">{evidence}</div>
        </div>
      </div>
    </section>
  );
}
