# Scientific Reports V1

Genithm Scientific Reports V1 turns a completed authoritative `scientific_job` into an immutable, reproducible report snapshot.

## Supported source jobs

- pairwise alignment
- multiple sequence alignment
- phylogenetic tree
- protein properties

The source job must be completed and have a recorded normalized result plus SHA-256 result hash.

## Trust boundary

The report is built inside Postgres from recorded Genithm data. The browser does not submit report content. V1 includes:

- project identity
- source job identity, completion time and result SHA-256
- authoritative tool/version/executor
- job parameters
- immutable sequence input hashes
- scientific workflow dependency hashes
- normalized authoritative result summary
- recorded provenance

AI interpretations and evidence follow-up answers are explicitly excluded from the sealed scientific truth snapshot.

## Integrity

`report_snapshot` is stored as `jsonb`. Before insert, Genithm computes SHA-256 over the Postgres `jsonb::text` representation and stores it as `report_sha256`.

`public.get_scientific_report(uuid)` is `SECURITY INVOKER`, remains subject to RLS, and recomputes the hash in Postgres. The UI and exports refuse trusted rendering when `integrity_valid` is false.

## Immutability and access

- RLS is enabled and forced on `public.scientific_reports`.
- Authenticated users can read only reports they created while they remain members of the owning organization.
- Direct INSERT, UPDATE and DELETE are not granted to clients.
- An immutable-table trigger rejects UPDATE and DELETE even for privileged application paths.
- Report creation is performed by an authenticated RPC that validates organization membership and source readiness.
- Creation appends a `SCIENTIFIC_REPORT_CREATED` event to the existing chained audit ledger.

## Export formats

A verified report can be downloaded as:

- JSON — the sealed snapshot
- Markdown — human-readable deterministic rendering of the sealed snapshot
- HTML — self-contained human-readable rendering with the report SHA-256 seal

Exports use private/no-store response caching and include `X-Genithm-Report-SHA256` and `X-Genithm-Source-SHA256` headers.

## V1 limitation

This slice covers generalized scientific jobs only. BLAST, NCBI sequence retrieval and protein-annotation reports can adopt the same immutable report contract in a later extension.
