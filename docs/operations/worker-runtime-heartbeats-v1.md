# Worker Runtime Heartbeats V1

Genithm release readiness now verifies both queue health and continuous worker liveness.

## Expected continuous workers

Exactly six worker kinds are allowlisted:

- `sequence_worker`
- `source_worker`
- `blast_worker`
- `scientific_worker`
- `audit_worker`
- `ai_worker`

Each continuously running worker records a bounded heartbeat every 30 seconds by default through the service-only `record_worker_heartbeat` RPC. `--once` executions do not emit heartbeats and therefore cannot make a production deployment appear continuously healthy.

The heartbeat contains only the allowlisted worker kind, bounded worker version, timestamps, and a counter. It contains no queue body, user identity, project identifier, sequence, result, prompt, or scientific evidence payload.

## Readiness policy

`get_release_readiness()` remains service-only and now returns queue metrics plus:

- `expected_worker_count`
- `missing_workers`
- `stale_workers`
- `worker_heartbeat_stale_after_seconds`
- `max_worker_heartbeat_age_seconds`

A worker is stale after 300 seconds. Production readiness is `ready` only when all expected queues exist, no queue with backlog is older than 15 minutes, and all six worker heartbeats are present and fresh.

This is intentionally fail-closed. Until the six worker images are actually deployed as continuous runtimes, readiness will report `not_ready` with the missing worker kinds.

## Security boundary

The heartbeat table lives in `app_private`, has forced RLS, and has no direct grants to `anon`, `authenticated`, or `service_role`. The private writer is `SECURITY DEFINER` with an empty `search_path` and accepts only the six worker kinds plus a bounded version string. The public wrapper is `SECURITY INVOKER`. Only `service_role` can execute the heartbeat RPC or readiness RPC.

Workers use a backend Supabase secret via the required `apikey` header. Secret keys must never be exposed to the browser or committed to the repository.
