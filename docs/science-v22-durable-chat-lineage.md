# Science V22 — Durable, consent-bound scientific pipeline lineage

## What changes

Science V20/V21 returned a valid science pipeline ID through a chat URL, but the URL was the only remembered locator. Science V22 saves that relationship on the **original user message** and reads it on subsequent visits to the same conversation.

- `public.ai_messages.research_pipeline_run_id` records the audited, authenticated pipeline run after explicit approval. A composite foreign key binds the run to the same project, organization and owner; a row-level check prevents attaching a run to an unverified or media-bearing user message.
- `approve_chat_research_pipeline(message_id)` is the only new user-callable approval path. It locks the original message, verifies actor, live conversation, project, organization membership and input scope, independently derives the RefSeq accession and fixed protocol from its stored content, invokes an **existing** quota-controlled pipeline RPC, validates the returned run's owner/scope and records the link in the same PostgreSQL transaction.
- Repeated approval of the same message returns its already-linked, authorized run; it does not dispatch a new one.
- The conversation reads linked runs under Supabase RLS, with explicit project and requester filters, and presents direct links next to the initiating messages. The latest owned, linked run is selected upon reopening without relying on a URL parameter. It fetches the **newest 250** messages and reverses them for chronological display, so long conversations don't hide newly approved research.
- Existing verified scientific download routes and recorded evidence safeguards are unchanged.

## Trust-boundary improvement

V21 checked sequence attachment IDs but could not tell whether a previously saved user message had included images. V22 adds `protocol_input_scope` with three states:

- `NULL` — older message or failed/untrusted attestation: **ineligible** for fixed pipeline approval.
- `text_only` — newly created message sealed as text-only by the trusted chat API.
- `with_attachments` — images or uploaded sequence attachments: **ineligible**.

The service-only `mark_chat_protocol_input_scope` RPC records the state from actual server-parsed request inputs before the chat response is produced. Browsers cannot set the scope, and historically unverified messages are not silently reclassified.

## Migration and rollout requirements

**The SQL is a reviewed source-code proposal, not a live migration execution.** Apply it first in a separate disposable/staging Supabase environment and execute the isolated security and functionality tests listed below before enabling or deploying the matching web code.

1. Verify that required V14/V16 pipeline migrations and the September direct-chat migrations exist in staging.
2. Generate/reconcile the migration with the installed Supabase CLI on the development host; verify migration history and lint/security advisors. The authoring environment used for this source-only PR did not have the Supabase CLI or a local PostgreSQL instance.
3. Apply the migration to staging, confirming functions, columns, composite foreign key and consent check exist. Confirm `authenticated` has only the expected `approve_chat_research_pipeline` execute grant and existing RLS SELECT permissions. `mark_chat_protocol_input_scope` must be callable only as `service_role`.
4. Test with two users in different organizations/projects: own text-only single-accession approval succeeds; foreign message access, forged URL, cross-project IDs, unmarked old messages, media, FASTA attachments, mixed identifiers and unsupported text all fail without launching science.
5. Verify duplicate clicks return one persisted link. The disposable two-session CI test now checks that concurrent approval blocks on the same saved message, returns the same committed pipeline ID, and that a rolled-back approval is retried to create exactly one durable run. Separately stage-test induced pipeline failures and a full downstream worker lifecycle.
6. Only after staging passes, schedule the **database-first** rollout followed by the web code; verify production readiness and rollback plan separately.

## Limits

- The tool-recognition contract remains deliberately narrow: direct, single-accession NCBI nucleotide ORF scanning or protein-property profiling only, never arbitrary AI-generated pipelines.
- Older V20 run URLs are **not backfilled or guessed**. Existing links remain useful only under the older code; once V22 is enabled, a fresh explicit approved message creates the durable binding.
- Conversation message queries are bounded to the existing latest 250 messages; this increment does not implement unlimited archived history search.
- GitHub CI replays migrations in a disposable local Supabase database and executes a rollback-only two-user integration test of cross-tenant denial, rejected input scopes, genuine approval/replay and service-only media attestation. The test also verifies that even a privileged direct UPDATE cannot create a cross-owner or unverified pipeline link.
- A dedicated disposable **two-connection contention test** uses an actual row-lock wait to validate both commit/idempotence and rollback/retry interleavings. Its fixture is committed only to the ephemeral local CI database, which is discarded when the job stops; it never connects to staging or production. This adds concurrency coverage but is **not** load testing, worker end-to-end verification or a live staging rollout.
- The new migration has **not** been applied to live Supabase, Oracle or Cloudflare. Production database compatibility and deployment readiness remain unverified.
