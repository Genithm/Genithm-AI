export function ResultInsightCard({
  title,
  status,
  summary,
}: {
  title: string;
  status: string;
  summary: string;
}) {
  return (
    <section className="card futuristic-card" style={{ marginTop: 18 }}>
      <div className="eyebrow">Scientific insight</div>
      <h2>{title}</h2>
      <div className="item">
        <strong>{status}</strong>
        <div className="small">{summary}</div>
      </div>
    </section>
  );
}
