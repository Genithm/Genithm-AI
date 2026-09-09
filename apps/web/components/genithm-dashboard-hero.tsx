export function GenithmDashboardHero({
  user,
}: {
  user: string;
}) {
  return (
    <section className="card futuristic-card">
      <div className="eyebrow">Genithm Research OS</div>
      <h1>Scientific intelligence workspace</h1>
      <p>
        Manage experiments, execute validated workflows, inspect evidence,
        and review reproducible scientific results from one interface.
      </p>
      <div className="small">Authenticated researcher: {user}</div>
    </section>
  );
}
