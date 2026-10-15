import { scienceWorkersReady } from "./science-worker-readiness.ts";

/** Exact, non-sensitive worker and queue names from the DB readiness contract. */
export const SCIENCE_WORKERS = [
  "ai_worker", "audit_worker", "blast_worker",
  "scientific_worker", "sequence_worker", "source_worker",
] as const;
export const SCIENCE_QUEUES = [
  "ai_evidence_followup", "ai_interpretation", "ai_planning",
  "audit_checkpoint_signing", "blast_remote", "ncbi_sequence_retrieval",
  "protein_annotation", "scientific_standard", "sequence_validation",
] as const;

export type ScienceWorkerKind = typeof SCIENCE_WORKERS[number];
export type ScienceQueueKind = typeof SCIENCE_QUEUES[number];
export type WorkerHealth = "heartbeat_current" | "stale" | "missing" | "unknown";
export type QueueHealth = "normal" | "stale_backlog" | "missing" | "unknown";
export type ScienceHealth = "ready" | "blocked" | "unavailable";

export type ScienceOperationsStatus = {
  schemaVersion: "genithm-science-operations/1";
  health: ScienceHealth;
  checkedAt: string | null;
  workerHeartbeatLimitSeconds: number;
  oldestWorkerHeartbeatSeconds: number | null;
  totalQueuedMessages: number | null;
  oldestQueuedMessageSeconds: number | null;
  workers: Array<{ kind: ScienceWorkerKind; health: WorkerHealth }>;
  queues: Array<{ kind: ScienceQueueKind; health: QueueHealth }>;
  warnings: string[];
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function validCount(value: unknown, maximum = 1_000_000_000): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) &&
    value >= 0 && value <= maximum ? value : null;
}

function validatedMembers<T extends string>(
  value: unknown,
  allowlist: readonly T[],
): T[] | null {
  if (!Array.isArray(value) || value.length > allowlist.length) return null;
  const allowed = new Set<string>(allowlist);
  const found = new Set<T>();
  for (const item of value) {
    if (typeof item !== "string" || !allowed.has(item) || found.has(item as T)) return null;
    found.add(item as T);
  }
  return [...found];
}

function unavailable(): ScienceOperationsStatus {
  return {
    schemaVersion: "genithm-science-operations/1",
    health: "unavailable",
    checkedAt: null,
    workerHeartbeatLimitSeconds: 300,
    oldestWorkerHeartbeatSeconds: null,
    totalQueuedMessages: null,
    oldestQueuedMessageSeconds: null,
    workers: SCIENCE_WORKERS.map((kind) => ({ kind, health: "unknown" })),
    queues: SCIENCE_QUEUES.map((kind) => ({ kind, health: "unknown" })),
    warnings: ["The trusted database readiness report is missing, invalid or out of date."],
  };
}

/**
 * Convert service-only Supabase release telemetry to a fixed public-safe shape.
 * Never return raw RPC error text, arbitrary queue names, worker versions,
 * secrets, project/user IDs, stored messages, artifacts, or queue payloads.
 */
export function scienceOperationsStatus(
  raw: unknown,
  now = Date.now(),
): ScienceOperationsStatus {
  const value = record(raw);
  if (!value || (value.status !== "ready" && value.status !== "not_ready")) {
    return unavailable();
  }
  const checkedAt = typeof value.checked_at === "string" ? Date.parse(value.checked_at) : NaN;
  if (!Number.isFinite(checkedAt) || !Number.isFinite(now) ||
      Math.abs(now - checkedAt) > 60_000) return unavailable();

  const missingWorkers = validatedMembers(value.missing_workers, SCIENCE_WORKERS);
  const staleWorkers = validatedMembers(value.stale_workers, SCIENCE_WORKERS);
  const missingQueues = validatedMembers(value.missing_queues, SCIENCE_QUEUES);
  const staleQueues = validatedMembers(value.stale_queues, SCIENCE_QUEUES);
  const workerLimit = validCount(value.worker_heartbeat_stale_after_seconds, 300);
  const queueCount = validCount(value.expected_queue_count, 9);
  const workerCount = validCount(value.expected_worker_count, 6);
  const totalBacklog = validCount(value.total_backlog);
  const heartbeatAge = value.max_worker_heartbeat_age_seconds == null
    ? null : validCount(value.max_worker_heartbeat_age_seconds);
  const queueAge = value.max_oldest_message_age_seconds == null
    ? null : validCount(value.max_oldest_message_age_seconds);
  if (!missingWorkers || !staleWorkers || !missingQueues || !staleQueues ||
      workerLimit === null || workerLimit < 1 || queueCount !== 9 ||
      workerCount !== 6 || totalBacklog === null ||
      (value.max_worker_heartbeat_age_seconds != null && heartbeatAge === null) ||
      (value.max_oldest_message_age_seconds != null && queueAge === null)) {
    return unavailable();
  }
  if (missingWorkers.some((x) => staleWorkers.includes(x)) ||
      missingQueues.some((x) => staleQueues.includes(x))) return unavailable();

  const missingWorkerSet = new Set(missingWorkers);
  const staleWorkerSet = new Set(staleWorkers);
  const missingQueueSet = new Set(missingQueues);
  const staleQueueSet = new Set(staleQueues);
  const ready = scienceWorkersReady(raw);
  const warnings: string[] = [];
  if (missingWorkers.length) warnings.push(`${missingWorkers.length} worker heartbeats missing.`);
  if (staleWorkers.length) warnings.push(`${staleWorkers.length} worker heartbeats older than ${workerLimit} seconds.`);
  if (missingQueues.length) warnings.push(`${missingQueues.length} required queues missing.`);
  if (staleQueues.length) warnings.push(`${staleQueues.length} queues have aged backlogs.`);
  if (!ready && warnings.length === 0) warnings.push("Release readiness is not confirmed by the database.");

  return {
    schemaVersion: "genithm-science-operations/1",
    health: ready ? "ready" : "blocked",
    checkedAt: new Date(checkedAt).toISOString(),
    workerHeartbeatLimitSeconds: workerLimit,
    oldestWorkerHeartbeatSeconds: heartbeatAge,
    totalQueuedMessages: totalBacklog,
    oldestQueuedMessageSeconds: queueAge,
    workers: SCIENCE_WORKERS.map((kind) => ({
      kind,
      health: missingWorkerSet.has(kind) ? "missing" :
        staleWorkerSet.has(kind) ? "stale" : "heartbeat_current",
    })),
    queues: SCIENCE_QUEUES.map((kind) => ({
      kind,
      health: missingQueueSet.has(kind) ? "missing" :
        staleQueueSet.has(kind) ? "stale_backlog" : "normal",
    })),
    warnings,
  };
}
