export function GovernanceStatusCard({
  verification,
}: {
  verification: {
    valid?: boolean;
    event_count?: number;
    head_sequence?: number;
    chain_version?: string;
  } | null;
}) {
  const valid = verification?.valid === true;

  return (
    <section className="card" style={{ marginTop: 18 }}>
      <div className="eyebrow">Integrity</div>
      <h3>Governance audit chain</h3>
      <p className="small">
        {valid
          ? "Platform administrator entitlement history integrity verified."
          : "Governance chain verification is unavailable or failed."}
      </p>
      <div className="list">
        <div className="item">
          <strong>Status</strong>
          <div className="small">{valid ? "Verified" : "Needs review"}</div>
        </div>
        <div className="item">
          <strong>Events</strong>
          <div className="small">{verification?.event_count ?? 0}</div>
        </div>
        <div className="item">
          <strong>Chain sequence</strong>
          <div className="small">{verification?.head_sequence ?? 0}</div>
        </div>
        <div className="item">
          <strong>Version</strong>
          <div className="small">{verification?.chain_version ?? "unknown"}</div>
        </div>
      </div>
    </section>
  );
}
