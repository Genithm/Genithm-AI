# Release readiness V1

Genithm separates liveness from readiness.

- `GET /api/v1/health` answers whether the API process is alive.
- `GET /api/v1/ready` answers whether the API can safely receive production traffic with its required Supabase queue dependency available.

## Queue dependency contract

The readiness database RPC expects these durable PGMQ queues:

- `sequence_validation`
- `ncbi_sequence_retrieval`
- `blast_remote`
- `scientific_standard`
- `protein_annotation`
- `audit_checkpoint_signing`
- `ai_planning`
- `ai_interpretation`
- `ai_evidence_followup`

The database uses `pgmq.metrics_all()` only. It does not read or return queue message bodies.

Readiness is `not_ready` when:

- any expected queue is missing; or
- any expected queue has a visible backlog whose oldest message is older than 15 minutes.

The response is intentionally bounded to queue names, counts, ages, and the database check timestamp. It never includes scientific inputs/results, AI prompts, frozen evidence, answers, storage paths, API keys, or message payloads.

## Authorization

`public.get_release_readiness()` is callable only by `service_role`. It is `SECURITY INVOKER` and delegates to an `app_private` helper that performs the PGMQ inspection. The private helper is also executable only by `service_role`.

The API calls the RPC using the backend-only Supabase secret key in the `apikey` header. The key must never be exposed to browsers or logged.

## Runtime behavior

Production requires `SUPABASE_URL` and `SUPABASE_SECRET_KEY` (or the API-specific aliases `GENITHM_API_SUPABASE_URL` and `GENITHM_API_SUPABASE_SECRET_KEY`). If production readiness credentials are absent, dependency access fails, the response is invalid, an expected queue is missing, or a stale backlog is detected, `/api/v1/ready` returns HTTP 503.

For local development without Supabase runtime credentials, readiness remains HTTP 200 and explicitly reports that the dependency check was skipped. This keeps local API tests independent from production credentials without weakening production behavior.

The Supabase dependency call is time-bounded by `GENITHM_API_READINESS_TIMEOUT_SECONDS`, defaulting to 3 seconds.

## Non-goals

V1 readiness does not dequeue, retry, archive, purge, cancel, or mutate queue messages. It does not attempt to repair worker failures. Operational repair remains an explicit, separately authorized action.
