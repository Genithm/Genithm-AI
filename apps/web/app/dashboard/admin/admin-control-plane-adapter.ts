import type {
  AdminControlPlaneViewModel,
  AdminGovernanceVerification,
  AdminSecurityEvent,
  AdminSecuritySignal,
  AdminSecuritySummary,
} from "./admin-control-plane-types";

export function toAdminControlPlaneViewModel(data: {
  governance: {
    roster: Array<Record<string, unknown>>;
    events: Array<Record<string, unknown>>;
    verification: unknown;
  };
  security: {
    summary: unknown;
    events: unknown[];
    signals: unknown[];
  };
}): AdminControlPlaneViewModel {
  return {
    governance: {
      roster: data.governance.roster,
      events: data.governance.events,
      verification: (data.governance.verification ?? {}) as AdminGovernanceVerification,
    },
    security: {
      summary: (data.security.summary ?? null) as AdminSecuritySummary | null,
      events: data.security.events as AdminSecurityEvent[],
      signals: data.security.signals as AdminSecuritySignal[],
    },
  };
}
