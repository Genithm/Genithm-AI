export function SecurityDetectionCard({
  signals,
}: {
  signals: Array<{
    signal_type: string;
    confidence: number;
    created_at: string;
  }>;
}) {
  return (
    <section className="card" style={{ marginTop: 18 }}>
      <div className="eyebrow">Detection layer</div>
      <h3>Security signals</h3>
      <p className="small">
        Detection outputs are separated from raw telemetry and presented as bounded signals.
      </p>

      <div className="list">
        {signals.map((signal, index) => (
          <div className="item" key={`${signal.signal_type}-${signal.created_at}-${index}`}>
            <strong>{signal.signal_type}</strong>
            <div className="small">
              Confidence: {(signal.confidence * 100).toFixed(1)}%
            </div>
            <div className="small">
              {new Date(signal.created_at).toLocaleString()}
            </div>
          </div>
        ))}

        {!signals.length ? (
          <div className="notice">No detection signals available.</div>
        ) : null}
      </div>
    </section>
  );
}
