/**
 * Science V26 deployment boundary.
 *
 * New code may reach main before the corresponding Supabase migration.
 * Explicit, server-only opt-in is mandatory before V22 fixed-protocol
 * attestation, approval, research archive or new-column queries are used.
 * The default is OFF in every environment, including production.
 */
export function scienceV22Configured(): boolean {
  return process.env.GENITHM_SCIENCE_V22_ENABLED === "true";
}

/**
 * A failed column-projection preflight means the deployment is not ready.
 * This must not fall back to an unverified scientific execution path.
 */
export function scienceSchemaReady(
  configured: boolean,
  projectionError: { code?: string; message?: string } | null,
): boolean {
  return configured && projectionError === null;
}

/** Only missing RPC/schema errors are eligible for a safe plain-chat fallback.
 * Never mask authorization, transient DB, validation, or quota errors.
 */
export function scienceSchemaUnavailableError(
  error: { code?: string; message?: string } | null,
): boolean {
  if (!error) return false;
  return error.code === "PGRST202" || error.code === "42703" ||
    error.code === "42883" || error.code === "PGRST204";
}
