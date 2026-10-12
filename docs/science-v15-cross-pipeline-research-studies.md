# Science V15 — cross-pipeline study and provenance-linked comparison

## Delivered functionality

An authenticated, project-scoped **Research Study** capability that assembles **2–8 already-completed V14 autonomous protein pipelines** into one reproducible comparison. Routes:

- /dashboard/pipeline-studies — completed-run selector, project filtering, search, evidence policy
- /dashboard/pipeline-studies/review — multi-column recorded protein properties and full lineage review
- /dashboard/pipeline-studies/export/json — private JSON with full original sealed report snapshots
- /dashboard/pipeline-studies/export/markdown — human-readable provenance and original numeric measures
- scripts/verify-pipeline-study.mjs — offline study/dossier SHA-256 consistency check

All are integrated with primary dashboard navigation and V14 pipeline operations.

## Scientific truth and secure data access

A selected run is eligible **only** when it has completed and its end-to-end evidence is valid under the current user’s Supabase RLS context:

1. Authenticated user with readable project/organization and exact owner-scoped pipeline IDs.
2. NCBI protein retrieval matches project, organization, owner, requested accession and recorded FASTA upload ID.
3. FASTA has completed validation as one protein sequence; its recorded SHA-256 matches the pipeline.
4. Approved protein-properties scientific job has completed, belongs to the same owner/project/organization, and carries a valid result SHA-256.
5. **Independent scientific_job_inputs verification** proves that exactly one input position 1 references that FASTA and exact source SHA-256. This strengthens the V14 read model, which checked stored pipeline metadata but not its underlying job input table.
6. Report index resolves one authoritative sealed report for each job. The existing owner-scoped get_scientific_report RPC recomputes each report’s original seal. The report must belong to the same project, represent exactly the completed protein-properties scientific job, and have a recorded result digest equal to the job result digest.
7. V12 sealed dossier assembly performs additional snapshot project/source identity checks and bounded size validation.

Cross-project, cross-owner, unknown, missing, duplicate, oversized or inconsistent evidence fails closed. No partial evidence is served. Results are obtained through standard authenticated Supabase clients; there is no service-role key or new privileged SQL function.

The maximum selection is eight pipeline IDs. All queries use bounded IN lists and no more than eight integrity RPCs; a max size of 512,000 bytes per original report and 2,000,000 total bytes is enforced by V12 dossier assembly.

## Reproducibility

The deterministic study payload includes sorted pipeline provenance records and the full V12 sealed dossier payload. The SHA-256 checksum is computed on recursively key-sorted compact JSON. JSON downloads carry both study and nested dossier digests.

    cd apps/web
    node --experimental-strip-types scripts/verify-pipeline-study.mjs study.json

This offline command verifies internal payload consistency and study-to-report identifiers only. It cannot independently authenticate the Supabase SQL report seals, recompute original scientific file bytes, confirm fresh upstream NCBI records or validate biological interpretations. The checksum is not a digital signature and can be replaced alongside a forged payload.

## Scope, release and deployment

V15 is application, authorization, evidence-assembly, UI, tests and docs. **No new schema migration or external scientific execution**. V15 depends on the V14 pipeline schema: until it is deployed in a reviewed production rollout, the study builder will report that authorized runs cannot be loaded.

Tests cover deterministic hashes, scientific_job_inputs forgery, malformed/duplicate selections, cross-tenant joins, unverified or mismatched reports, incomplete pipelines, oversized report snapshots and missing-value comparison semantics.

Required CI:

    cd apps/web
    node --experimental-strip-types --test tests/pipeline-study.test.mjs
    npm run typecheck
    npm run build

All Cloudflare, dependency, security and worker release checks must pass before merging. Production rollout and real research-user acceptance remain separate.
