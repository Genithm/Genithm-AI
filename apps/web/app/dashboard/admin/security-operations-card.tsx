export function SecurityOperationsCard({
  summary,
}: {
  summary: {
    last_24_hours?: Record<string, number>;
    critical_events?: number;
    detection_signals?: number;
  } | null;
}) {
  const severities = summary?.last_24_hours ?? {};

  return (
    <section className="card" style={{ marginTop: 18 }}>
      <div className="eyebrow">Security operations</div>
      <h3>Security posture overview</h3>
      <p className="small">
        Aggregated telemetry only. Raw security events remain behind internal boundaries.
      </p>

      <div className="list">
        <div className="item">
          <strong>Critical events (24h)</strong>
          <div className="small">{summary?.critical_events ?? 0}</div>
        </div>
        <div className="item">
          <strong>Detection signals (24h)</strong>
          <div className="small">{summary?.detection_signals ?? 0}</div>
        </div>
        {Object.entries(severities).map(([severity, count]) => (
          <div className="item" key={severity}>
            <strong>{severity}</strong>
            <div className="small">{count}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
