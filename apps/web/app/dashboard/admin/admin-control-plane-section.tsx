import { PlatformAdminGovernancePanel } from "./governance-panel";
import { GovernanceStatusCard } from "./governance-status-card";
import { SecurityControlPlane } from "./security-control-plane";
import { getAdminControlPlaneData } from "./admin-control-plane-data";

export async function AdminControlPlaneSection() {
  const data = await getAdminControlPlaneData();

  return (
    <>
      <PlatformAdminGovernancePanel
        roster={data.governance.roster}
        events={data.governance.events}
      />
      <GovernanceStatusCard verification={data.governance.verification} />
      <SecurityControlPlane
        summary={data.security.summary}
        events={data.security.events}
        detections={data.security.signals}
      />
    </>
  );
}
