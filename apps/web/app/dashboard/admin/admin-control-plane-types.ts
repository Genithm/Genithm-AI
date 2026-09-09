export type AdminGovernanceVerification = {
  valid?: boolean;
  event_count?: number;
  head_sequence?: number;
  head_hash?: string;
  chain_version?: string;
};

export type AdminSecuritySummary = {
  last_24_hours?: Record<string, number>;
  critical_events?: number;
  detection_signals?: number;
};

export type AdminSecurityEvent = {
  event_id: string;
  event_type: string;
  severity: string;
  source: string;
  occurred_at: string;
};

export type AdminSecuritySignal = {
  signal_id: string;
  signal_type: string;
  confidence: number;
  created_at: string;
};

export type AdminControlPlaneViewModel = {
  governance: {
    roster: Array<Record<string, unknown>>;
    events: Array<Record<string, unknown>>;
    verification: AdminGovernanceVerification;
  };
  security: {
    summary: AdminSecuritySummary | null;
    events: AdminSecurityEvent[];
    signals: AdminSecuritySignal[];
  };
};
