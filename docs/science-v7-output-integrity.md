# Science V7 — production scientific output gate and tenant-scoped phylogeny

This milestone changes the actual `apps/scientific-worker` production paths, not Codespaces preview. It introduces defense-in-depth validation and preserves the existing Supabase schema, tool versions, approved scientific algorithms, result formats, and queue/RPC contracts.

## Boundaries

Before downloading an MSA dependency for a phylogenetic job, the worker requires a canonical source path:

`organization_uuid/project_uuid/source_msa_job_uuid/msa-result.fasta`

All three UUIDs, source digest, declared size, sequence count, aligned length, sequence type and model are validated. The source cannot be the consuming job. A forged cross-organization, cross-project, or unrelated MSA artifact path must be rejected before any network request. The existing database dependency relationship remains authoritative.

The downloaded source FASTA must independently validate as a set of exactly 3–50 equally aligned, uniquely and canonically labeled sequences. The observed alignment width must match the queue claim. The independent artifact audit runs on **all five scientific job types before any storage upload or success RPC**, including non-JSON MAFFT FASTA and FastTree Newick.

- MAFFT result auditing verifies canonical ordered FASTA, declared sequence type/alphabet, nonempty biological content, count, aligned length, hashes and expected provenance against the job claim.
- FastTree result auditing parses and validates canonical Newick, exact leaf set, branch/support constraints, computed leaf/support counts, tool provenance and tenant-bound source metadata.
- Existing JSON audit remains in effect for pairwise, sequence insights and protein properties.

Malformed or mismatched result evidence is non-retryable `output_validation`; it must not upload or acknowledge a successful job.

## Limits and scope

This is not proof of tree topology accuracy or cryptographic producer authenticity. The checks depend on trusted queue claims, existing Supabase authorization/dependency constraints and verified storage SHA-256. Biological authenticity and phylogenetic inference should be evaluated separately.

No Supabase migration, live production data changes, Oracle deployment, model credentials or UI preview work is included. Worker code reaches production only through the established image release and deployment controls.

## Regression verification

```sh
python -m pytest apps/scientific-worker/tests
```

The V7 test module covers cross-tenant object paths, malformed source metadata, source alignment width mismatch, independently tampered Newick metrics, invalid MSA alphabets and fail-closed runtime behavior before upload.

