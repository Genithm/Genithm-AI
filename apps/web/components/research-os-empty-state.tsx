export function ResearchOsEmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <section className="card futuristic-card" style={{ marginTop: 18 }}>
      <div className="eyebrow">Research workspace</div>
      <h2>{title}</h2>
      <p>{description}</p>
    </section>
  );
}
