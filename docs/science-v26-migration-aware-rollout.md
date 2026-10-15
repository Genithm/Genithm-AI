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
- `scripts/science_staging_readiness.py`: a **manual local operator command**, not a GitHub workflow. The repository security policy prohibits secrets in CI workflows. This script requires separate staging and production project refs and a direct TLS-only staging DB URL, refuses production and malformed IDs, and runs only read-only SQL through `psql`. `scripts/tests/test_science_staging_readiness.py` checks those target protections in secretless CI.

These checks do not claim to validate production scientific worker throughput or actual downloaded bytes.

## Staging configuration (requires a staging project and authorized operator)

1. Provision an **isolated, separate** staging Supabase project. Never point the staging audit at the existing Genithm production database.
2. Run the script from an approved operator machine with Python 3 and `psql`; do not paste secrets into ChatGPT, commit them, or expose them as GitHub workflow variables.
3. Set `GENITHM_STAGING_SUPABASE_REF` to the separate staging project reference, `GENITHM_PRODUCTION_SUPABASE_REF` to the public live project reference, and `GENITHM_SCIENCE_STAGING_DATABASE_URL` to a private direct staging connection URI ending in `/postgres?sslmode=require`. The script refuses missing or identical references, non-direct hosts, insecure TLS settings, and malformed IDs.
4. Review and apply the V22 migration in the isolated staging database through normal migration history mechanisms. The audit script never applies migrations.
5. From the repository root, with only those environment variables in the operator's process:

```bash
python3 scripts/science_staging_readiness.py
```

   It must report `SCIENCE_V26_READY` before enabling the staging science feature.
6. Configure only the **staging web server** with `GENITHM_SCIENCE_V22_ENABLED=true`. Never use a `NEXT_PUBLIC_*` prefix.
7. Complete the two-user end-to-end staging workflow, from explicit approval through real NCBI retrieval, FASTA validation, scientific worker, checksum-backed authenticated download, and a 250+-message archived conversation. Exercise both fixed NCBI workflows.
8. Optionally rerun the audit for a completed staging run:

```bash
python3 scripts/science_staging_readiness.py \
  --message-id "<STAGING_USER_MESSAGE_UUID>" \
  --run-id "<STAGING_PIPELINE_UUID>"
```

   This checks the recorded lineage but not stored artifact bytes.
9. With reviewed staging acceptance, separately approve and schedule a **database-first** production migration. Enable the production server flag only after verifying grants, live schema, workers, and download checks.
10. **Rollback:** Disable `GENITHM_SCIENCE_V22_ENABLED` on the production web server. Existing chat remains available even if the V22 migration has been applied.

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
