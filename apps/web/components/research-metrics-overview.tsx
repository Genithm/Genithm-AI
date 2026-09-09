export function ResearchMetricsOverview({
  organizations,
  projects,
  analyses,
}: {
  organizations: number;
  projects: number;
  analyses: number;
}) {
  const metrics = [
    ["Research groups", organizations],
    ["Active projects", projects],
    ["Scientific analyses", analyses],
  ];

  return (
    <section className="grid">
      {metrics.map(([label, value]) => (
        <div className="card futuristic-card" key={label}>
          <div className="eyebrow">{label}</div>
          <h2>{value}</h2>
        </div>
      ))}
    </section>
  );
}
