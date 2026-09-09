import { grantPlatformAdmin, revokePlatformAdmin } from "./governance-actions";

export function PlatformAdminGovernancePanel({
  roster,
  events,
}: {
  roster: Array<{
    user_id: string;
    email: string;
    display_name: string | null;
    has_verified_mfa: boolean;
  }>;
  events: Array<{
    event_id: string;
    action: string;
    target_email: string | null;
    actor_email: string | null;
    reason: string;
    occurred_at: string;
  }>;
}) {
  return (
    <section className="card" style={{ marginTop: 18 }}>
      <div className="eyebrow">Governance</div>
      <h3>Platform administrators</h3>
      <p className="small">
        Privileged entitlement changes require MFA/AAL2 and are recorded in the governance audit chain.
      </p>

      <div className="list">
        {roster.map((admin) => (
          <div className="item" key={admin.user_id}>
            <strong>{admin.display_name ?? "Unnamed admin"}</strong>
            <div className="small">{admin.email}</div>
            <div className="small">
              Verified MFA: {admin.has_verified_mfa ? "yes" : "no"}
            </div>
            <form action={revokePlatformAdmin} style={{ marginTop: 8 }}>
              <input type="hidden" name="target_user_id" value={admin.user_id} />
              <input name="reason" minLength={3} maxLength={500} required placeholder="Revocation reason" />
              <button className="button" type="submit">Revoke admin</button>
            </form>
          </div>
        ))}
      </div>

      <h3 style={{ marginTop: 18 }}>Grant administrator</h3>
      <p className="small">Use the verified user id returned by the exact-email candidate lookup.</p>
      <form action={grantPlatformAdmin}>
        <input name="target_user_id" required placeholder="User ID" />
        <input name="reason" minLength={3} maxLength={500} required placeholder="Grant reason" />
        <button className="button primary" type="submit">Grant admin</button>
      </form>

      <h3 style={{ marginTop: 18 }}>Governance history</h3>
      <div className="list">
        {events.map((event) => (
          <div className="item" key={event.event_id}>
            <strong>{event.action}</strong>
            <div className="small">Target: {event.target_email ?? event.event_id}</div>
            <div className="small">Actor: {event.actor_email ?? "unknown"}</div>
            <div className="small">{event.reason}</div>
            <div className="small">{new Date(event.occurred_at).toLocaleString()}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
