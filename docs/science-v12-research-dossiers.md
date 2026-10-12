# Science V12 — cross-tool research dossiers and reproducibility packages

## Product goal

Research spans NCBI retrieval, BLAST, pairwise and multiple sequence alignments, phylogeny, protein annotation, and molecular property analysis. V12 allows an authorized researcher to select **2–8 existing sealed scientific reports from a single project**, compare source-specific numeric findings, and export a combined research dossier.

### End-to-end flow

1. Open Research Dossiers from the primary dashboard or scientific reports.
2. Select an accessible project and choose 2–8 sealed source reports from the latest 200.
3. Open the dossier preview. The server independently re-queries each selected report using the existing owner-scoped get_scientific_report SQL RPC, which recomputes the original database-sealed snapshot SHA-256.
4. Cross-project, missing, malformed, oversized, and tampered report snapshots are rejected.
5. The viewer displays report seals, evidence categories, project identity, and a comparison table. Metrics missing from a source remain blank, not zero.
6. Export JSON (all verified original report snapshots, comparison and reproducible payload checksum) or Markdown (seals and numeric comparison).

### Security and limits

- RLS-scoped, authenticated Supabase client throughout. No service role, admin token, user-supplied storage path, model key or new privileged RPC.
- Explicit project authorization and a second source/snapshot project-and-resource identity check.
- Between 2 and 8 unique report UUIDs, no more than 8 RPC reads per request.
- Single snapshot bound: 512,000 canonical characters; aggregate 2,000,000 characters.
- Missing authorized resources 404, invalid integrity or cross-project records 409, oversized 413; never return partial private evidence after validation failure.
- Private no-store, nosniff and restrictive content security headers for exports.
- No migrations, live SQL changes, scientific recomputation, model synthesis or unapproved retries.

### Integrity scope

The dossier payload SHA-256 is computed over recursively key-sorted compact JSON, including all original sealed report snapshots. It is deterministic regardless of selected report order. The existing SQL RPC rechecks each original report seal before the bundle is assembled.

**A checksum is not a signature.** An attacker who can replace both payload and checksum could forge an internally consistent package. Independent report authenticity still relies on the Genithm database seal at export time, while scientific validity and upstream freshness require their respective evidence and validation.

### Offline checksum verification

    cd apps/web
    node --experimental-strip-types scripts/verify-research-dossier.mjs path/to/dossier.json

The local verifier checks checksum and source/project identities, not external scientific authenticity.

### CI and acceptance

    cd apps/web
    npm ci
    node --experimental-strip-types --test tests/research-dossier.test.mjs
    npm run typecheck
    npm run build

The regression suite includes 2–8 report bounds, duplicate/malformed UUIDs, deterministic sorted package hashes, project and source identity forgeries, tampered seals, oversized payloads, source-specific numerical measures and missing-value semantics.

Existing Cloudflare compatibility, dependency audit, security and scientific worker checks must also pass before GitHub main merge.

Production deployment, integration testing against real users, and full platform release readiness remain separate.
