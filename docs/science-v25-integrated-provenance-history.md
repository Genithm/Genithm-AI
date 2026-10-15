# Science V25 — Integrated research history, provenance and release gate

## Scope and branch stacking

Science V22 (PR #204) establishes atomic, actor-bound fixed research consent and persists a run ID on the original user message. Science V23 (PR #205) adds cumulative evidence dossiers. Science V24 (PR #206) adds a secure, project-filtered research archive and owner-verified older conversation links.

**V25 is the integration branch based on V24**. It brings V23's scientific dossier implementation and regression tests into the same code as V24, resolving their overlapping conversation-page changes. It does **not** merge or deploy V22, V23 or V24 into `main`.

## Integrated researcher journey

1. **Explicit consent:** The chat offers only the two narrowly supported fixed NCBI protocols. The saved original message must be text-only and is approved by the authenticated, atomic V22 RPC. The researcher controls whether science starts.
2. **Durable lineage:** The approved run is linked to its original message, project, organization and owner. The 32-case UI/SQL intent parity and concurrent approval/rollback tests remain required.
3. **Recover from any conversation age:** V24 indexes the original linked messages across accessible projects, paging by timestamp plus stable UUID. Clicking an archive entry includes **both the run ID and saved source-message ID**.
4. **Deep-link authorization:** The chat verifies that precise message-to-run pair is bound to the requested conversation and current user. An old URL cannot select an unrelated user's pipeline or silently fall back to a different run.
5. **Evidence completeness:** V23 evidence checks now apply to **recent and recovered historical runs**. The selected, authenticated older run gets priority within the 100-run evidence-dossier cap; this avoids losing it when 100 newer science runs exist.
6. **One verified evidence decision:** The selected research panel, cumulative dossier and archive evidence badge all use the same pure V23 `buildConversationDossier` validation rules. A parent reporting `completed` is **not** automatically called scientifically verified.
7. **Proof of provenance:** Verified findings require matching requested NCBI accession/database, exact retrieved upload ID, validated FASTA and SHA-256, single matching scientific input row at position 1, approved job type and fixed ORF parameters, valid result fingerprint, and recorded object location. Raw biological sequences and private storage paths are never exported by the dossier. The existing authenticated download route verifies artifact bytes when requested.
8. **Clear failure:** Missing or contradictory child rows yield an incomplete/unknown evidence state. Failure to load evidence records produces an explicit unavailable/error state and **never** a verified download. The archive makes the separate engine and evidence statuses visible for every linked study.
9. **Bounded cost:** The archive retrieves 25 message links per page and batches child database queries, rather than N+1 calls. It builds an isolated per-run dossier for each authorized pipeline, without mixing data across conversations. The conversation dossier remains bounded at 100 science runs.

## Automated verification

```bash
cd apps/web
node --experimental-strip-types --test \
  tests/chat-fixed-research-protocol-v20.test.mjs \
  tests/chat-pipeline-lineage-v22.test.mjs \
  tests/conversation-fixed-pipeline-dossier-v23.test.mjs \
  tests/research-archive-v24.test.mjs \
  tests/integrated-science-history-v25.test.mjs
npm run typecheck
npm run build
```

Existing GitHub CI and disposable local Supabase migration workflow validate V22/V24's authorization and pagination contracts; V25 adds its own focused integrated regressions. The V25 integration must run as its own **final-head CI**, because separate green PRs do not prove the combined code is correct.

## Staging release acceptance (not executed here)

Use a **separately configured and approved isolated staging environment**, not production:

1. Verify the staged Git revision, migration history and readiness. Deploy V22 SQL **before** the corresponding web code. Check grants, RLS, security-definer boundaries, quotas and owner scopes; use a dedicated two-user staging fixture.
2. Send a genuinely authenticated text-only request for one supported RefSeq nucleotide ORF workflow and separately one supported RefSeq protein-property workflow. Ensure neither proceeds before an explicit research approval.
3. With permission, approve each through the UI. Capture the original user message ID, created pipeline ID and source accessions. Verify repeat clicks and concurrent clicks return the same linked run.
4. Check real downstream worker progression: NCBI retrieval, FASTA validation, science job completion/error handling and recorded SHA-256 chain. Do not simulate a scientific output by manually setting the parent status.
5. Run the **read-only** SQL audit with the approved `message_id` and `run_id`:

```bash
psql "$GENITHM_STAGING_DB_URL" -X -v ON_ERROR_STOP=1 \
  -v message_id="<STAGING_USER_MESSAGE_UUID>" \
  -v run_id="<STAGING_PIPELINE_UUID>" \
  -f supabase/tests/v25_staging_evidence_readonly.sql
```

A single `PASS: recorded lineage consistent` row means the *recorded database lineage* satisfies the fixed contract. No rows, or `REVIEW`, is a release blocker. It **does not independently attest sequence contents or object bytes**; verify the existing authenticated checksum-enforcing download separately.

6. Open the same study from a current conversation, export a dossier, then create 275+ additional chat messages in staging and verify the archived study is accessible from its exact original consent link. Inspect the archive's separate engine and evidence statuses and the same checksum-backed download.
7. Try an unrelated account, forbidden organization/project, altered source-message ID, altered run ID, mixed/unsafe prompt, sequence/media attachment, malformed cursor, negative consent and unavailable child rows. All must fail closed and avoid false verified findings.
8. Review staging service logs, failure/rollback behavior, worker timeouts, monitoring, concurrent load, quota use and recovery. Confirm **no secrets, raw sequences or internal object paths** are leaked by exports.
9. Only then request separate authorization for any production migration or deployment; do not automatically merge stacked draft PRs.

## Remaining limits

- This staging audit is source code only and has not been executed against any remote Supabase instance. Its SQL transaction is `READ ONLY`; a privileged staging connection may bypass RLS, so the SQL checks exact owner/project/organization lineage and is **not** a substitute for UI RLS testing.
- The archive is page- and message-scoped, not a global count of unique runs; legitimately deduplicated pipeline runs may appear under more than one approved original message.
- The current conversation presents 250 latest messages; archive pagination recovers older studies individually. It is not infinite chat message pagination.
- Verified database provenance does not replace a signed scientific artifact checksum check at download.
- This source-only increment **must not** touch live Supabase, Oracle or Cloudflare and remains in draft until V22 staging migration verification and V25 integrated CI are approved.
