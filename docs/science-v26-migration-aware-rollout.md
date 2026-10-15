# Science V26 — Migration-aware release guard and staging acceptance

## Why V26 is necessary

Science V22–V25 source code was merged into `main` on 15 October 2026. The connected Genithm Supabase project was verified **read-only** and did not yet contain either `public.ai_messages.protocol_input_scope`, `public.ai_messages.research_pipeline_run_id`, `public.approve_chat_research_pipeline(uuid)`, or `public.mark_chat_protocol_input_scope(uuid,uuid,boolean)`. Chat streaming in the merged V25 revision attempted the latter RPC even for normal conversation turns; the conversation page requested the two absent columns.

V26 closes this release-sequencing gap. It is a **source-code change**, not an automatic migration or production deployment.

## Runtime contract

- `GENITHM_SCIENCE_V22_ENABLED` is a **server-only** environment variable; it must equal exactly `true` to opt in. Missing, false, and any other string disable fixed science.
- With the flag off, the chat API never calls the V22 input-attestation RPC and never proposes a fixed NCBI pipeline; it continues to use the existing `request_ai_chat_turn`, normal streaming provider, and `finish_ai_chat_turn` flow.
- With the flag off, the conversation page uses only the pre-V22 message columns. It normalizes the two missing science fields to `null`, **not** `text_only`, and never offers a fixed research approval.
- With the flag off, forged approval form submissions are rejected server-side *before* new-column queries or the science approval RPC.
- With the flag off, `/dashboard/ai/research` explains that the research archive is not enabled and links back to usable conversations.
- With the flag on, every relevant server entry point probes the two columns with a zero-row projection. When the schema projection fails, science remains unavailable.
- The chat API recognizes only missing-function/schema errors as safe reasons to fall back to normal chat after the science attestation call. Authorization, resource limits, and transient database errors are not silently treated as successful science consent.

**The flag is not authorization.** Even after activation, V22's authenticated approval RPC must independently verify the saved message, researcher, project, organization, source scope, and exact approved protocol.

## Tests

- `apps/web/tests/science-release-v26.test.mjs`: server flag defaults, missing RPC-code classification, plain-chat fallback, old message queries, archive unavailability, and refusal of a forged approval.
- `supabase/tests/v26_science_release_readiness.sql`: read-only checks for new message columns, RPCs, forced RLS, scope FK and consent constraint, plus the intended `authenticated`/service-role execute grants.
- `.github/workflows/supabase-local-ci.yml`: after migration replay, asserts `SCIENCE_V26_READY` under disposable local Postgres.
- `.github/workflows/science-staging-readiness.yml`: a **manual** workflow with a protected `science-staging` environment. It refuses to run outside the checked-in `main` branch, requires a different staging/production project reference, requires the direct staging DB hostname to match that exact staging ref, and **only** runs read-only SQL.

These checks do not claim to validate production scientific worker throughput or actual downloaded bytes.

## Staging configuration (requires repository administrator)

1. Provision an **isolated, separate** staging Supabase project. Do not point a test runner or secret at the existing Genithm production project.
2. Create a protected GitHub Actions environment named `science-staging` with appropriate reviewer permissions and environment secret `GENITHM_SCIENCE_STAGING_DATABASE_URL`, set to the **direct PostgreSQL connection URL** of this separate project. Never commit or share the password.
3. Set GitHub Actions environment/repository variable `GENITHM_PRODUCTION_SUPABASE_REF` to the live project's **public project reference** (not an access key). The workflow **fails closed** if this value is absent or if it matches the chosen staging ref.
4. Review and apply V22's migration to the isolated staging database using the normal migration history mechanism. Do not use this read-only workflow to apply migrations.
5. Run the manual **Science staging readiness** workflow against the staging ref. A clean staging schema must return `SCIENCE_V26_READY`.
6. Configure the staging **web server environment only** with `GENITHM_SCIENCE_V22_ENABLED=true`. Do not add this variable as `NEXT_PUBLIC_*`; it must not be required in client bundles.
7. Complete two-user end-to-end staging science execution from explicit approval through real NCBI retrieval, FASTA validation, scientific worker, checksum-backed authenticated download, and an archived conversation older than 250 messages. Use both supported fixed NCBI workflows.
8. Optionally rerun the manual workflow with a *completed staging* `approved_message_id` and `approved_run_id`. The V25 read-only audit must report a consistent source-to-result chain. It does not check artifact bytes.
9. After reviewed staging acceptance, schedule a **database-first** production migration. Only turn on the production server flag after the migration, grants, schema cache, worker readiness and download checks have been explicitly verified.
10. **Rollback:** Disable `GENITHM_SCIENCE_V22_ENABLED` on the web server to hide consent, the archive and new-column projections while leaving normal AI chat functioning. This is safer than rolling back a migration which has already stored research lineage.

## Production acceptance checklist

- [ ] Separate staging project provisioned and target reviewed
- [ ] Schema migration history and V22 grants verified in staging
- [ ] Safe server flag remains off in production before database readiness
- [ ] Authenticated, multi-tenant staging negative cases and concurrency verified
- [ ] Both fixed NCBI pipelines executed end-to-end in staging
- [ ] Recorded provenance and byte integrity checked
- [ ] Older archived message recovered and independently authorized
- [ ] Read-only staging audit returns one consistent completed record
- [ ] Production database-first deployment separately approved
- [ ] Production post-migration schema probe and rollback path confirmed

**Nothing in V26 automatically applies the migration or changes production Supabase, Oracle or Cloudflare.**
