import { PlatformAdminGovernancePanel } from "./governance-panel";
import { GovernanceStatusCard } from "./governance-status-card";
import { SecurityControlPlane } from "./security-control-plane";
import { OperationsReadinessCard } from "./operations-readiness-card";

export function AdminSecuritySections({
  governance,
  security,
  readiness,
}: {
  governance: {
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
    verification: {
      valid?: boolean;
      event_count?: number;
      head_sequence?: number;
      chain_version?: string;
    } | null;
  };
  security: {
    summary: {
      last_24_hours?: Record<string, number>;
      critical_events?: number;
      detection_signals?: number;
    } | null;
    events: Array<Record<string, unknown>>;
    signals: Array<Record<string, unknown>>;
  };
  readiness: Array<{
    name: string;
    status: string;
    detail: string;
  }>;
}) {
  return (
    <>
      <PlatformAdminGovernancePanel
        roster={governance.roster}
        events={governance.events}
      />
      <GovernanceStatusCard verification={governance.verification} />
      <SecurityControlPlane
        summary={security.summary}
        events={security.events}
        detections={security.signals}
      />
      <OperationsReadinessCard checks={readiness} />
    </>
  );
}
