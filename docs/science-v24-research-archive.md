# Science V24 — Owner-scoped approved research archive and deep-history recovery

## Purpose

Science V22 persists each user's explicit approval of an NCBI fixed research protocol on the original chat message. Science V23 adds scientific evidence to the current conversation's dossier, but both UI views are intentionally bounded to the **newest 250 messages**. Before V24, old approved studies outside this window were neither discoverable nor selectable via their original deep link.

V24 adds a researcher-facing approved-research index at `/dashboard/ai/research`, with secure recovery of older runs from their original conversations.

## Delivered behavior

1. **Account-scoped history:** Every archive page starts with the authenticated Supabase claims and queries `ai_messages` with `conversation_owner_id=auth.uid()`, `role=user`, and `research_pipeline_run_id IS NOT NULL`. The archive never scans all research jobs to infer which chat they belong to.
2. **Authorization at every boundary:** Under the same user's RLS client, related conversations must have `created_by=user`, pipeline runs must have `requested_by=user`, and retrieved project IDs must match the stored message's project. Missing or inaccessible metadata is never turned into a link.
3. **Stable historical pagination:** Fetch 26 linked messages, display 25, then paginate with the tuple (`created_at DESC, id DESC`); an older page requires `created_at < cursor_time OR (created_at = cursor_time AND id < cursor_id)`. Both values are strictly validated before entering the PostgREST `.or(...)` filter. The project filter is checked against the researcher's accessible projects. Invalid cursors fail closed rather than silently resetting the result set.
4. **Deep-history recovery:** The conversation page accepts a `pipeline_id` outside the latest 250 messages only after a separate authenticated lookup finds the *original linked user message in that exact conversation*, owned by the current user. The selected run is then independently checked against the user's project and requester ID. The old prompt text and timestamp are displayed in an explicitly marked recovered-request section.
5. **Honest status labels:** The archive distinguishes `Engine completed`, `Engine failed`, running, validation and retrieval states. **An engine status is not a verified biological finding**. Results remain subject to the provenance protections in V23 and the existing authenticated result-download integrity check.
6. **Discoverability and accessibility:** The existing Genithm chat page and conversation sidebar link to the archive. The index has accessible headings, a labeled project filter, a mobile-compatible card layout, explicit error states and older/newer navigation.

No additional SQL schema, RPC, policy, background worker, external research request, queue, deployment or authentication grant is introduced.

## Test coverage

- `apps/web/tests/research-archive-v24.test.mjs` tests valid and malicious query parameters, exact cursor round-trip, scientific-status honesty, explicit caller ownership/project bounds, historical-link authorization, and archive navigation.
- `supabase/tests/v24_research_archive_pagination.sql` runs with rollback against **disposable local Supabase**, creating 275 newer ordinary chat messages and 27 older approved-message fixtures, all sharing the same historical timestamp. One run is actually user-approved; the remaining repeated links are privileged *test fixture setup only* to avoid unnecessary NCBI quota use. The test verifies older-than-250 recovery, stable 25+2 keyset pages with no overlap, access by the rightful user, and invisibility to a second user in a separate organization.
- The test suites run as required GitHub CI gates. Production build and TypeScript checks remain part of the existing web CI.

## Limitations and release gates

- The archive shows a **page of approved messages**, not a unique-count aggregation of NCBI run IDs. Multiple approvals that legitimately deduplicate to the same pipeline can appear separately.
- The project drop-down displays the first 200 RLS-visible projects; entering a valid accessible project ID outside this set remains supported by the route, although it may not be listed as a select option.
- Archive pages contain no raw FASTA, storage paths, private result JSON, or service-role data. Historical prompt text appears only when reopening a run from its owner-verified original conversation.
- A keyset cursor is not an authorization token. It can be shared or modified, but cannot broaden the logged-in user's RLS access.
- Staging still must test the complete consent → NCBI retrieval → FASTA validation → scientific job → evidence/dossier → archived conversation flow. Local pagination and SQL RLS tests are not full worker end-to-end verification.
- **Dependency sequence:** V24 is built on the Science V22 feature branch (PR #204) and is independently reviewable from Science V23 (PR #205). Both downstream features require the V22 database-first staging rollout. Before release, reconcile these stacked branches and rerun all relevant tests on the final integration SHA.
- **No live Supabase, Oracle, or Cloudflare changes** are made by this source-only PR.
