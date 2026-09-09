import { getPlatformAdminGovernanceData } from "./governance-data";
import { getSecurityControlPlaneData } from "./security-control-plane-data";

export async function getAdminControlPlaneData() {
  const [governance, security] = await Promise.all([
    getPlatformAdminGovernanceData(),
    getSecurityControlPlaneData(),
  ]);

  return {
    governance,
    security,
  };
}
