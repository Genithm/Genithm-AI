export function SecurityEventTimeline({
  events,
}: {
  events: Array<{
    event_id: string;
    event_type: string;
    severity: string;
    source: string;
    occurred_at: string;
  }>;
}) {
  return (
    <section className="card" style={{ marginTop: 18 }}>
      <div className="eyebrow">Security events</div>
      <h3>Recent security activity</h3>
      <p className="small">
        Security telemetry is displayed through bounded views and does not expose private event metadata.
      </p>

      <div className="list">
        {events.map((event) => (
          <div className="item" key={event.event_id}>
            <strong>{event.event_type}</strong>
            <div className="small">
              Severity: {event.severity} · Source: {event.source}
            </div>
            <div className="small">
              {new Date(event.occurred_at).toLocaleString()}
            </div>
          </div>
        ))}
        {!events.length ? <div className="notice">No recent security events.</div> : null}
      </div>
    </section>
  );
}
