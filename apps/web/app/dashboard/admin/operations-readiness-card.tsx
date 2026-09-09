export function OperationsReadinessCard({
  checks,
}: {
  checks: {
    name: string;
    status: "ready" | "warning" | "blocked";
    detail: string;
  }[];
}) {
  return (
    <section className="card" style={{ marginTop: 18 }}>
      <div className="eyebrow">Production readiness</div>
      <h3>Operations checks</h3>
      <p className="small">
        Operational readiness indicators are surfaced without exposing internal secrets or credentials.
      </p>
      <div className="list">
        {checks.map((check) => (
          <div className="item" key={check.name}>
            <strong>{check.name}</strong>
            <div className="small">{check.status}: {check.detail}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
