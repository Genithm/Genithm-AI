/**
 * Science V27: the real job-running services must be up before a new
 * fixed-protocol approval is offered or accepted.
 *
 * The server obtains this JSON from the existing service-role-only
 * get_release_readiness() RPC. Client inputs NEVER authorize readiness.
 */
export function scienceWorkersReady(snapshot: unknown): boolean {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return false;
  const state = snapshot as Record<string, unknown>;
  if (state.status !== "ready") return false;
  if (!Array.isArray(state.missing_workers) || state.missing_workers.length > 0) return false;
  if (!Array.isArray(state.stale_workers) || state.stale_workers.length > 0) return false;
  if (!Array.isArray(state.missing_queues) || state.missing_queues.length > 0) return false;
  if (!Array.isArray(state.stale_queues) || state.stale_queues.length > 0) return false;
  if (typeof state.expected_worker_count !== "number" || state.expected_worker_count < 6) return false;
  if (typeof state.expected_queue_count !== "number" || state.expected_queue_count < 9) return false;
  if (typeof state.worker_heartbeat_stale_after_seconds !== "number" ||
      state.worker_heartbeat_stale_after_seconds > 300 ||
      state.worker_heartbeat_stale_after_seconds < 1) return false;
  // Readiness is refreshed by the database RPC; reject forged / stale replies
  // if a future API cache is accidentally introduced.
  if (typeof state.checked_at !== "string") return false;
  const timestamp = Date.parse(state.checked_at);
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > 60_000) return false;
  return true;
}
