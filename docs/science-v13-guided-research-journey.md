# Science V13 — Guided NCBI-to-science research journey

## Delivered scope

An end-to-end **guided research workspace** at /dashboard/research-journey connects real project evidence across NCBI retrievals, normalized single-record FASTA sequence uploads, authorized scientific input records, executed scientific jobs and sealed reports.

- Use the existing authenticated NCBI retrieval RPC to request one current accession per form submission.
- Select validated compatible sequences and dispatch pairwise global alignment or MAFFT using the existing approved RPCs, validated again server-side.
- Trace exact relationships only when the NCBI retrieval's sequence_upload_id matches a scientific_job_inputs.sequence_upload_id and job_id in the same authorized project.
- Link completed scientific job results and sealed source/analysis reports from their actual recorded identifiers.
- Connect existing AI chat, operations, reports, and dossier workspaces into one researcher-facing workflow.

## Scientific truth and automation boundary

This milestone **does not invent an unattended accession-to-BLAST/MAFFT chain**. NCBI retrieval finishes asynchronously, FASTA input validation follows the established source/sequence worker process, and each analysis is separately approved via an explicit user action. The existing MSA-to-FastTree workflow remains the only automatically dispatched two-step scientific execution.

A shared project, name or timestamp does not prove provenance. The V13 linked-history panel uses exact stored source-upload/job-input relationships only. A project may contain uploaded sequences unrelated to NCBI; those may be explicitly selected for analysis but are never labeled as NCBI-originated without a recorded link.

## Authorization, resource boundaries and safety

- All reads and RPCs use the current user's authenticated Supabase client and existing RLS; no service-role key or privileged client.
- The selected project is required to exist and be active and accessible through RLS.
- Server actions re-read sequence status, SHA-256, number of FASTA records and types before requesting computation.
- Allowed NCBI accession syntax, databases, job sizes, scoring and rate limits remain enforced by existing RPCs.
- Exact cross-project upload, scientific input and report edges are required; unauthorized evidence is never intentionally joined.
- Queries are bounded to recent 80 retrievals, 150 uploads, 150 jobs, 500 input references, and 150 reports. This is a recent snapshot, not a complete all-time lineage graph.
- No schema migration, production data modification outside normal user-requested RPC actions, unapproved retries, or UI preview.

## Regression and release

The research-journey unit tests cover exact provenance traversal, cross-project input and report isolation, malformed hashes, retrieval/validation/job lifecycle outcomes, and type-compatibility guards. GitHub CI runs those alongside the earlier scientific tests and production web/Cloudflare checks.

    cd apps/web
    node --experimental-strip-types --test tests/research-journey.test.mjs
    npm run typecheck
    npm run build

Live production deployment and research-user acceptance are separate from this source-code milestone. Further V13+ automation should be added only with idempotent authoritative database state machines, user authorization and proven source-to-result linkage.
