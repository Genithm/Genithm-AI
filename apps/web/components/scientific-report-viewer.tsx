export function ScientificReportViewer({
  title,
  summary,
  provenance,
}: {
  title: string;
  summary: string;
  provenance: string;
}) {
  return (
    <section className="card futuristic-card" style={{ marginTop: 18 }}>
      <div className="eyebrow">Scientific report</div>
      <h2>{title}</h2>
      <div className="list">
        <div className="item">
          <strong>Result summary</strong>
          <div className="small">{summary}</div>
        </div>
        <div className="item">
          <strong>Provenance</strong>
          <div className="small">{provenance}</div>
        </div>
      </div>
    </section>
  );
}
