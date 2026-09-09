export function ResearchOsErrorState({
  message,
}: {
  message: string;
}) {
  return (
    <section className="card futuristic-card" style={{ marginTop: 18 }}>
      <div className="eyebrow">Workspace alert</div>
      <h2>Research workspace needs attention</h2>
      <div className="item">
        <strong>Unable to load research layer</strong>
        <div className="small">{message}</div>
      </div>
    </section>
  );
}
