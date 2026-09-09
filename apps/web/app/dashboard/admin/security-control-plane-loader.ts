import { getSecurityControlPlaneData } from "./security-control-plane-data";

export async function loadAdminSecurityControlPlane() {
  const result = await getSecurityControlPlaneData();

  return {
    summary: result.summary,
    events: result.events,
    signals: result.signals,
    hasErrors: Boolean(
      result.errors.summary ||
        result.errors.events ||
        result.errors.signals,
    ),
  };
}
