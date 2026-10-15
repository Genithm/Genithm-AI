# Science V27 — Runtime worker gate and single-project activation

## Verified state on 15 October 2026

- The existing Genithm Supabase project `vowmjjgkjoxcvlfamukh` has the complete five-migration Science V22–V26 schema and its 32-case parser fixture passed.
- GitHub's `main` CI, Worker release and API release succeeded. Their artifacts are **immutable Docker images**, not active Oracle deployments.
- The live database's service-role-only `get_release_readiness()` reported `not_ready`. Its six workers had **stale** last-seen heartbeats (roughly four days old); no worker was fresh.
- Fixed NCBI research requires **continuous worker processes**, not merely compiled code, published images, and database functions.
- The Cloudflare application environment is managed outside the GitHub/Supabase connections available for this development session. A passing Wrangler dry run or Cloudflare contract test is not evidence of a live Workers deployment or an enabled environment variable.

## New guard

V26's server-only `GENITHM_SCIENCE_V22_ENABLED=true` flag remains mandatory. V27 adds the existing service-only `get_release_readiness()` RPC before any new V22 consent offer and again when the human approves. Fixed research is permitted **only** when:

1. The feature is enabled server-side.
2. Both V22 message columns are available in the authenticated caller's Supabase schema.
3. The trusted service-role readiness RPC returns a current `ready` report with six expected workers and nine expected queues, no missing or stale workers or queues, and the database's 300-second worker freshness threshold.
4. The original message and authenticated actor pass V22's independent project, organization, text-only attachment scope and fixed-protocol authorization checks.

**Fail closed** on missing Supabase service credentials, unavailable health RPC, stale timestamps, missing/stale workers, queue failures and any RPC error. A missing worker does **not** authorize a new request.

Existing chat still works through normal provider streaming. Historical research and completed dossiers are still available when science workers are offline. The conversation shows an explicit worker-offline notice instead of approval controls. The approval server action rechecks liveness because workers can go offline after a form was rendered.

## Operational steps in the existing project (not another Supabase project)

The database is ready. The remaining actions are **not database migrations**:

1. On the already provisioned Oracle worker host, retrieve the six immutable image digests from a successful GitHub `Worker release` artifact for a tested main commit. Never use a mutable `latest` tag.
2. Configure backend-only `deploy/oracle/.env.workers` securely. Do not share service keys, NCBI provider identity or audit private keys in GitHub Issues, a browser session or this chat. Follow `docs/deployment/ORACLE_V1.md`.
3. From the matching checked-out revision on the worker host, run the existing security preflight and start worker Compose:
```bash
python scripts/oracle_deploy_preflight.py workers --env-file deploy/oracle/.env.workers --compose
docker compose --env-file deploy/oracle/.env.workers -f deploy/oracle/docker-compose.workers.yml config
docker compose --env-file deploy/oracle/.env.workers -f deploy/oracle/docker-compose.workers.yml pull
docker compose --env-file deploy/oracle/.env.workers -f deploy/oracle/docker-compose.workers.yml up -d --remove-orphans
docker compose --env-file deploy/oracle/.env.workers -f deploy/oracle/docker-compose.workers.yml ps
```
4. Verify fresh worker heartbeats using authorized server-side readiness; all six must be fresh for at least two checks separated by more than 30 seconds.
5. Validate the API gateway health and readiness at the configured API ingress (see `docs/deployment/ORACLE_V1.md`).
6. Deploy the tested Cloudflare `genithm-web` revision and configure `GENITHM_SCIENCE_V22_ENABLED=true` **only in its server-side environment**, after worker readiness. Keep `SUPABASE_SECRET_KEY` private. In contrast, `NEXT_PUBLIC_*` variables are browser-exposed.
7. Using a dedicated **non-admin** authenticated development test account, perform both supported fixed NCBI studies through the actual UI: source accession -> text-only user message -> review -> Approve -> NCBI retrieval -> validated FASTA -> scientific job -> verified dossier -> checksum-enforcing download -> archived conversation.
8. Confirm second-account project isolation, negative consent tests, retries, and an older-than-250-message archive deep link. The developer user explicitly authorized use of the **existing** Supabase project, but this test account/host and its credentials are not available through the connected tools.
9. If a worker goes offline, V27 immediately suppresses new approvals while old research remains readable. To pause all fixed science regardless of worker status, unset `GENITHM_SCIENCE_V22_ENABLED`.

## Verification

- `apps/web/tests/science-worker-readiness-v27.test.mjs` checks ready, absent, stale, corrupt, replayed, and missing-worker/queue snapshots, and verifies the server action rechecks readiness.
- Existing V22, V23, V24, V25, V26 and Supabase Local CI suites remain required.
- The deployment is **not complete** until live Oracle workers are running and the authenticated E2E test passes. CI alone cannot attest a running Oracle host or Cloudflare server configuration.

**No new Supabase project or database migration is needed for V27.**
