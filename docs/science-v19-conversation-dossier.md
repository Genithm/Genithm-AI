# Science V19 - evidence-backed research dossier in chat

## Scope

Science V19 integrates and extends the earlier local-only V18 research-dossier package. It is a GitHub application change only: no live Supabase writes, migrations, secrets or production deployments.

The user-facing flow remains:

Chat request -> missing information clarification -> plan -> owner-approved scientific execution -> trusted worker result -> evidence in the original conversation.

## Implemented

- Builds a bounded conversation-wide dossier from already authenticated, RLS-scoped queries over AI plans, science jobs, BLAST, NCBI retrieval, protein annotation and fixed MSA-to-phylogeny workflows.
- Queries MSA and phylogenetic child jobs under the authenticated Supabase session with project-id scoping. Workflow completion requires the workflow parent AND both actual child jobs to report completed status.
- Uses the allowlisted Science V17 recorded-evidence projection. Raw biological inputs, provider internals and arbitrary JSON keys do not enter the dossier.
- Missing or inaccessible execution records are labeled unknown rather than fabricated as complete. NCBI not_found and protein no_mapping are inconclusive outcomes, not completed results.
- Provides local in-conversation JSON and Markdown export without a new API endpoint or database permission.
- Shows an existing server-side SHA-256-verified scientific artifact download only for a completed job with an admissible checksum and object reference.
- Keeps the research chat composer available for follow-up messages.

## Safety and limitations

The dossier is a read-only presentation of stored computational observations, not an experimentally validated biological conclusion. It does not grant authorization, dispatch arbitrary tools, consume a service-role key or replace database RLS and the explicit plan-approval boundary.

This release does not introduce unrestricted autonomous multi-step execution. Only workflows already explicitly implemented and authorized by the backend can run. Broader dependent workflows will need idempotent scheduling, quotas, failure handling, explicit consent, RLS and production readiness reviews.

## Verification

The V19 regression suite tests completion gating, project scope, approved vs running plans, explicit dependency lineage, integrity hash checks, inconclusive/failure states, safe exports and suppression of raw inputs and secrets.

Test command: cd apps/web && node --experimental-strip-types --test tests/conversation-research-dossier-v19.test.mjs

The new test runs in GitHub CI alongside Next.js, Cloudflare, backend, dependency audit and worker-image security validation.
