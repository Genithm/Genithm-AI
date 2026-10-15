# Science V29 — Research operations and release readiness control plane

## Scope

Science V22–V28 code and database migrations are present on the existing Genithm Supabase project. The current operational blocker is **not a missing migration**: on 15 October 2026, service-only `public.get_release_readiness()` reported `not_ready` with six stale worker heartbeats, zero queue backlog and all nine expected queues present. GitHub's green Worker release publishes immutable images; it does not deploy continuous containers onto Oracle.

V29 delivers a new **read-only, authenticated operations console** so a platform operator can see the difference between source-code validation, database capabilities and the real deployed science-worker runtime, without touching user research or scientific payloads.

## Surfaces

- `/dashboard/admin/science`: server-rendered operations page. **Platform admin only**. Checks the signed-in Supabase session with `auth.getClaims()`, then the database-backed `is_platform_admin()` RPC, then reads sanitized service-only runtime telemetry. Non-admin callers receive a 404, unauthenticated callers are redirected to login.
- `/api/admin/science/health`: GET-only JSON read endpoint with the same *end-user session* and `is_platform_admin()` check before any service-role call. Replies are `private, no-store`, `nosniff`, and use no-referrer headers. Unauthenticated → 401, non-admin → 404, telemetry unavailable → 503. It is **not a public monitoring endpoint**. Never share its contents outside the ops team.
- `/dashboard/admin`: links to the new operations page.
- `/dashboard/ai`: simple authenticated researcher-facing notice *only when science was server-enabled but its workers are unavailable*. The researcher receives no privileged worker, queue, account or service-key details.

## Trust and data protection

The sole privileged telemetry source is the *existing* service-role-only `public.get_release_readiness()` RPC. The server also makes a zero-row projection for two V22 schema columns, and runs five `head: true`, `count: exact` reads to count research pipelines by status. It **never selects or returns** accessions, user identities, project IDs, chat contents, sequence bytes, queue message bodies, storage paths, or scientific outputs.

`scienceOperationsStatus()` parses an allowlist of exactly **six expected worker names** and **nine queue names**. It rejects unknown or duplicate identifiers, missing/corrupt arrays, inconsistent worker states, unexpectedly changed expected-worker/queue counts, out-of-bounds numeric metrics, stale/replayed (>60 seconds) timestamps, and an invalid heartbeat threshold. On errors it produces `unavailable`, not a fabricated success or database error message. A valid `not_ready` snapshot produces `blocked` and explains missing/stale worker heartbeats and queues. A `ready` snapshot can still be blocked if worker facts contradict it. None of these signals is a substitute for scientific-result provenance.

The UI's `Eligible for fixed science` gate requires **all three** of:

1. `GENITHM_SCIENCE_V22_ENABLED=true` in server-only runtime config.
2. The V22 columns are available.
3. The trusted service-role readiness report is fresh and says `ready`, with six workers, nine queues, and no missing/stale dependencies.

A green gate still **never grants consent**. The original message, text-only attestation and authenticated approval RPC remain authoritative. The console is intentionally read-only; no restart, pause, queue mutation, diagnostic injection, or privileged user lookup is added.

## Operations runbook

1. Sign in with the private platform-admin entitlement and visit `/dashboard/admin/science`. Ordinary researchers cannot access it.
2. If all workers are stale, check the Oracle worker host, Docker Compose status and logs. Retrieve immutable image digests from a tested GitHub Worker release. The existing `docs/deployment/ORACLE_V1.md` explains the required host-side, secret-protected commands.
3. Confirm all six continuous containers are actually running and have published fresh 30-second heartbeats at least twice. A Docker-image publication or an API health-only check does not count.
4. Verify all nine queues and the readiness RPC, plus API `/api/v1/ready`, and ensure scientific source, sequence and analysis workers can reach their external dependencies.
5. Set `GENITHM_SCIENCE_V22_ENABLED=true` *only in the deployed web server*, with Supabase backend key kept out of `NEXT_PUBLIC_*`. The UI gate will turn eligible only after the flag, schema and worker conditions all agree.
6. Run the two fully authenticated, explicitly approved fixed NCBI pipelines and verify source accession/FASTA hashes, result metadata, authenticated artifact bytes and cross-tenant RLS. Close GitHub issue #210 only with real end-to-end evidence.
7. To pause new fixed research, unset the server feature flag. Existing evidence and normal chat remain accessible. Do not delete old queues, job rows or research evidence as a recovery tactic.

## Verification and known limits

`apps/web/tests/science-operations-v29.test.mjs` covers valid ready/degraded samples, all six workers and nine queues, replayed snapshots, malicious/unknown identifiers, privacy of raw telemetry, server-only privilege boundaries, routing entitlements, disabled mutation actions, and researcher-facing redaction. CI also runs TypeScript, Next.js build, Cloudflare web contract and previous Science V20–V28 regressions.

**No new Supabase project or schema migration is needed.** This feature cannot operate the Oracle host or activate Cloudflare variables from GitHub/Supabase connections alone, and does not claim to complete live E2E scientific execution.
