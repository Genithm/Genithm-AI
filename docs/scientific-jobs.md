# Generalized scientific jobs

Genithm executes reusable scientific analyses through an allowlisted, asynchronous job boundary. The API/browser does not execute scientific algorithms directly.

## Control flow

`authenticated request -> validated RPC -> scientific_jobs + scientific_job_inputs -> scientific_standard PGMQ -> isolated scientific worker -> private result artifact -> validated finalization -> provenance + audit`

The initial implementation proves the framework with Pairwise Alignment. Future MSA and other deterministic tools should reuse the same job, input, result, provenance, audit, rate-limit, and worker boundaries rather than creating arbitrary execution endpoints.

## Tool registry

Approved executors are registered in `app_private.scientific_tools`. A registry entry pins the tool ID/version and records operational policy such as runtime kind, network requirement, timeout, memory, CPU, maximum compute size, and parameter schema. Clients cannot read or mutate the registry directly.

Pairwise V1 is registered as:

- tool: `genithm-pairwise-aligner`
- version: `0.1.0`
- algorithms: global Needleman-Wunsch and local Smith-Waterman
- linear gap scoring
- no external scientific network dependency
- maximum 9,000,000 dynamic-programming cells
- maximum 2 MiB per FASTA artifact at worker read time
- exactly one validated, ungapped FASTA record per input
- matching sequence types only

Tie-breaking is deterministic: diagonal, then up, then left.

## Security boundary

Authenticated users may request a Pairwise Alignment only through `request_pairwise_alignment`. The RPC validates project write access, tenant ownership, input readiness, input hashes, single-record status, sequence type compatibility, scoring parameters, resource limits, rate limits, concurrency limits, and approved tool state.

`scientific_jobs` and `scientific_job_inputs` are read-only to authenticated organization members under forced RLS. Clients do not receive INSERT, UPDATE, or DELETE privileges.

Only `service_role` may claim or finalize scientific jobs through the narrow worker RPCs. The worker receives no arbitrary shell command, executable path, SQL, URL, or user-defined code. Job type and tool version are allowlisted.

The scientific worker re-downloads the private input artifacts and verifies exact byte length plus SHA-256 before execution. Raw biological inputs are not persisted in Postgres.

## Reproducibility

Every request receives a SHA-256 request fingerprint derived from the job type, project, ordered input IDs and hashes, pinned tool/version, and normalized parameters. Concurrent identical active requests are deduplicated.

Completed jobs persist:

- input SHA-256 values
- normalized parameters
- pinned tool ID/version
- executor version
- request fingerprint
- normalized result summary
- private result artifact path
- result SHA-256 and byte size
- provenance JSON
- lifecycle timestamps
- audit-ledger events

The Pairwise artifact is canonical JSON with schema version `genithm-pairwise-result/1`. It contains the two aligned sequences, normalized metrics, and provenance. It is stored in the private `analysis-results` bucket.

## Failure and retry policy

Input-integrity failures are terminal. Infrastructure failures are retryable with bounded attempts and queue delay. Result paths are deterministic and uploads are non-overwriting so a retry cannot silently replace a previously persisted scientific artifact.

The database validates result path, artifact existence, result metadata, input hashes, algorithm, metrics, tool/version, executor version, and request fingerprint before marking a job completed.

## Runtime deployment

`apps/scientific-worker` is packaged as a non-root container. CI verifies that it can run under a read-only filesystem, dropped Linux capabilities, `no-new-privileges`, bounded PIDs/CPU/memory, and no network for the CLI smoke test. CI also blocks fixable HIGH/CRITICAL image vulnerabilities and produces a CycloneDX SBOM.

A real worker deployment needs only server-side runtime configuration:

- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`
- `GENITHM_SCIENTIFIC_VISIBILITY_SECONDS`
- `GENITHM_SCIENTIFIC_MAX_ATTEMPTS`
- `GENITHM_SCIENTIFIC_POLL_SECONDS`

The Supabase secret key must be stored in the deployment secret manager and must never be exposed to browsers or committed to source control.

Until a continuous worker runtime is deployed, Pairwise requests can be accepted and queued but should not be described as automatically executing in production.
