# Science V23 — Fixed NCBI pipelines in the cumulative chat research dossier

## Purpose

Science V22 persists the original chat message → approved NCBI research pipeline link and rehydrates it in the conversation. V23 includes **all such owner-scoped linked pipeline runs** in the existing cumulative research dossier (JSON and Markdown export), alongside the conversation's pre-existing AI-plan analyses.

No new scientific execution path, database migration, account permission, queue, external API request, provider, or production deployment is introduced.

## Evidence rules

The dossier only trusts child records queried through the authenticated researcher's Supabase session and constrained to the same project and requester. It batches retrievals, validated sequence uploads, scientific jobs and their precise input records for **at most 100 chat-linked runs** from the latest message window.

For a fixed NCBI pipeline to show `completed`, all these must be recorded:

1. The parent pipeline status is `completed` and the template is one of `ncbi_nucleotide_orf_v1` or `ncbi_protein_profile_v1`.
2. The linked NCBI retrieval is `retrieved`, with the expected source database (`nucleotide` or `protein`), the original requested accession, and a `sequence_upload_id` that matches the pipeline's validated FASTA record.
3. The linked FASTA upload is `ready` and its SHA-256 matches the pipeline's recorded `sequence_sha256`.
4. Exactly one recorded scientific-job input matches the expected upload ID and the same SHA-256 (input position 1).
5. The scientific job is `completed` with the correct job type: `sequence_insights` for ORF or `protein_properties` for protein profiling.
6. The ORF job, when relevant, has `operation=orf_scan` and `min_aa=30`.
7. The result has a valid 64-digit SHA-256 and nonempty object path.

If any dependency is missing, out-of-scope, or contradictory, a parent marked `completed` appears as `unknown`; no completed metrics, result checksum or download is invented. Failed and running parent states never fabricate findings.

Allowlisted scalar values from the already-recorded scientific job summary may be displayed or exported. Arbitrary JSON, raw biological sequences, confidential metadata, and internal object paths are **not** included. The download URL is the existing authenticated, integrity-checked result route; *the dossier does not claim to have downloaded or rehashed object bytes itself*.

## User-visible effect

- Reopened conversations present one cumulative, mixed dossier covering plan-based science **and** approved fixed NCBI pipelines.
- Per-run identities are stable and explicit in exported JSON (either a `plan_id` or a `pipeline_id`).
- The panel no longer says "No scientific activity yet" when fixed research runs are present.
- The selected-run detail panel uses the **same provenance-checked steps and evidence decision** as the cumulative dossier, rather than independently trusting completion flags. If the engine reports completion but provenance is incomplete, the panel shows an unverified status and suppresses both measurements and download links.
- The previous individual run progress and integrity-checked scientific download links remain available.

## Verification and rollout

```bash
cd apps/web
node --experimental-strip-types --test tests/conversation-research-dossier-v19.test.mjs
node --experimental-strip-types --test tests/conversation-fixed-pipeline-dossier-v23.test.mjs
npm run typecheck
npm run build
```

V23 is **dependent on V22**; review [Science V22 PR #204](https://github.com/Genithm/Genithm-AI/pull/204) and deploy its database-first migration through an isolated staging gate before V23 is considered deployable. This enhancement must remain unmerged until both PRs pass required CI and the release sequence is approved.

### Limits

- The dossier includes at most 100 distinct fixed pipeline IDs from the newest 250 loaded conversation messages; it is not a full historical archive/search service.
- Input lineage is checked from recorded database rows, including retrieval-to-FASTA identity. Actual artifact byte integrity is checked separately by the authenticated download endpoint.
- A pipeline that completes without a visible child record is not assumed successful, even if the parent says `completed`.
- No Oracle, Cloudflare or live Supabase state was mutated by this source-code change.
