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
    { label: "Research groups", value: organizations, hint: "Organizations you can access" },
    { label: "Projects", value: projects, hint: "Active research workspaces" },
    { label: "Analyses", value: analyses, hint: "Tracked scientific runs" },
  ];

  return (
    <section className="metric-grid" aria-label="Workspace metrics">
      {metrics.map((metric) => (
        <article className="metric-card" key={metric.label}>
          <div className="metric-label">{metric.label}</div>
          <div className="metric-value">{metric.value}</div>
          <div className="metric-hint">{metric.hint}</div>
        </article>
      ))}
    </section>
  );
}
