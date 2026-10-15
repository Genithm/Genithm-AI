# Science V21 — fixed research consent hardening

## Scope

This increment hardens the already merged V20 chat-first, human-approved NCBI reference workflows. It introduces **no new pipelines**, migrations, data access grants, providers, compute algorithms, or production deployment.

## Security and correctness changes

- Fixed protocol suggestions now require a single-line direct request (imperative, direct "can/could/would/will you", or "I want/would like ... to ..."). Descriptions, tutorials, hypotheticals, embedded script/command instructions, and negative statements stay in ordinary chat.
- An apparently valid accession followed by another dotted numeric suffix is not accepted by partial regex matching.
- At the server-side approval boundary, the original user message is read under the authenticated user/conversation constraints **including its saved attachment IDs**. A message with any saved FASTA/sequence attachment cannot start this reference-only protocol, even if a malicious/stale browser submits its message ID. The existing audited per-project Supabase RPCs remain the final authorization, quota and job-deduplication boundary.
- Failed parent runs cannot display stale child jobs as still running. A completed parent cannot turn missing/inconsistent child evidence into fabricated completion; these steps instead display *unknown*.

## Rollout and limits

- All V20 fixed NCBI protocols still require explicit user button approval before backend dispatch. The rule-based intent detector is deliberately conservative and is **not** a general natural-language planner.
- Neither this code change nor the PR tests modify live Supabase, Oracle or Cloudflare.
- UI chat proposals are not durable pipeline-to-message lineage. A future database-backed consent ledger should bind exact original message, media/sequence inputs and resulting run ID in one atomic operation.
- The status timeline reflects source records, not measured biological correctness; use the established integrity-checked scientific output for authoritative findings.

## Verification

```bash
cd apps/web
node --experimental-strip-types --test tests/chat-fixed-research-protocol-v20.test.mjs
npm run typecheck
npm run build
```

The V21 checks are appended to the existing V20 test suite so that the current GitHub CI test step runs them automatically. Merge only after full CI is green.
