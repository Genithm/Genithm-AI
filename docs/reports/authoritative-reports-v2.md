# Authoritative Scientific Reports V2

Scientific Reports V2 extends Genithm's immutable report contract beyond generalized scientific jobs while preserving every V1 report.

## Supported report sources

- `scientific_job`: Pairwise Alignment, Multiple Sequence Alignment, Phylogenetic Tree, Protein Properties.
- `blast_job`: completed NCBI BLAST results with normalized hits and raw-result provenance.
- `sequence_retrieval`: finalized live NCBI retrievals, including authoritative `not_found` outcomes.
- `protein_annotation_job`: completed or `no_mapping` source-backed protein annotation outcomes.

## Trust model

The browser never supplies report scientific content. The authenticated request supplies only an allowlisted source type and source UUID. PostgreSQL loads the finalized authoritative record, validates organization membership and terminal state, builds the report snapshot, computes its source-evidence SHA-256 and report SHA-256, and appends the creation event to the tamper-evident audit chain.

Reports remain owner-scoped under forced RLS. Authenticated clients receive SELECT only on the report table; they do not receive INSERT, UPDATE, or DELETE. Report UPDATE and DELETE are additionally blocked by the existing immutable trigger.

AI interpretation and evidence follow-up output are deliberately excluded from the report snapshot.

## V1 compatibility

Existing `scientific-report-v1` rows are backfilled with the generic source identity and evidence digest. Their original report JSON and report SHA-256 are not changed. The V2 reader supports both schema versions and recomputes integrity from the stored snapshot before trusted rendering or export.

## Evidence digests

V2 computes `source_evidence_sha256` over a canonical JSONB evidence document assembled from the recorded source. Underlying source/result hashes remain embedded in provenance, including scientific-result SHA-256, BLAST raw-result SHA-256, NCBI response SHA-256, and protein-annotation upstream response hashes when available.

## Export

Integrity-verified reports remain exportable as JSON, Markdown, and standalone HTML. Exports carry the report SHA-256 and source-evidence SHA-256 in response headers.

## Boundaries

V2 does not rerun external scientific sources when a report is generated. It freezes the already recorded authoritative result and provenance from the source operation. Freshness therefore means the report preserves when and how the source operation checked the authoritative upstream service; report generation itself does not silently refresh or substitute that evidence.
