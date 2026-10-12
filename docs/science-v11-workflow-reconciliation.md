# Science V11 — workflow reconciliation and evidence-based recovery diagnostics

## Objective

Expose the authoritative MAFFT multiple-sequence alignment → FastTree phylogeny workflow as a dedicated production research execution page. The workflow already has a database-triggered handoff and its own lifecycle. V11 does not introduce a new retry API or bypass job and queue authority.

## Implementation

- The chat workspace and unified Operations center link to /dashboard/workflows/[id] rather than only the last scientific job.
- A server-only loader reads the workflow, prerequisite MSA, optional downstream tree, and exact source-MSA dependency through the **current authenticated Supabase client with existing RLS**.
- Scientific job scope must match workflow organization, project, owner, ID and expected job type.
- The source MSA result SHA-256 must equal the tree dependency recorded SHA-256. Dependency IDs, role and scope must also match.
- The reconciliation engine checks the two-stage lifecycle, impossible transitions, missing tree dispatch after MSA completion, false completion, missing dependency evidence and unusual job duration.
- The responsive UI displays status, timestamps, attempts, recorded hashes, links, metadata lineage classification and operator guidance.
- Private no-store JSON export includes only the diagnostic metadata and no raw sequences, prompts, AI completions, secrets or worker error bodies.
- The page refreshes every 20 seconds while running and not in an inconsistent state; hidden tabs do not poll.

## Recovery safety

The migration 20260921203000_ai_msa_phylogeny_workflow_v1.sql implements MSA-to-tree advancement and lifecycle finalization. The later race-guard migration addresses approval/completion races. An independent auto-replay loop could duplicate scientific work.

This milestone **performs no workflow mutations**. It never requeues, reruns, forces dependencies into completed state, resets attempts or dispatches a second tree. Missing handoffs or inconsistent states produce investigation guidance, not unapproved replay.

The >5-minute queued and >15-minute running thresholds are advisory, not proof of stuck execution. A dependency hash match validates **recorded metadata lineage**, not independently hashed storage bytes. Raw result download still uses V8 SHA-256 verification.

## Security and errors

- Exact UUID input, authenticated getClaims, owner-scoped workflow RLS SELECT.
- Child queries constrained by organization, project, actor, job ID and dependency role.
- Database errors produce generic unavailable status; no partial private evidence.
- No service role, privileged SQL function, migration or mutable operation.
- JSON export is private/no-store and uses nosniff headers.

## Tests and delivery

New Node regression tests cover normal two-stage progression, genuine SHA-256 dependency lineage, missing and mismatched hashes, cross-tenant and cross-owner forgeries, missing handoffs, failed prerequisites, false completion, terminal statuses with active jobs, timing thresholds, invalid identifiers and sensitive-data minimization.

The existing operations test now verifies dedicated workflow navigation.

Run CI tests and build from apps/web:

    npm ci
    node --experimental-strip-types --test tests/workflow-reconciliation.test.mjs
    node --experimental-strip-types --test tests/research-operations.test.mjs
    npm run typecheck
    npm run build

All required GitHub web, Cloudflare, locked dependency and security policy checks must pass before merge.

Scope: application code and tests. No preview, live Supabase schema modification or production deployment.
