# Science V8 — verified artifact downloads and correct job-state UI

The authenticated scientific job page must present **database job states exactly**, never leave failed/cancelled jobs polling forever, and must not hand researchers corrupted scientific artifacts.

## What changed

- Scientific job status now recognizes the authoritative `error` and `cancelled` terminal states, treats `validating_result` as active and stops refreshing terminal jobs.
- The result page renders failure/cancellation explicitly and labels hashes as **recorded** evidence rather than claiming verification merely because metadata is present.
- The authenticated download route is tenant-scoped by the Supabase RLS-controlled job row. Before storage access, the recorded path must match its fixed, allowlisted organization/project/job and result-format path.
- The route rejects nonexistent, unfinished, unsupported, malformed or oversized result metadata.
- Downloaded private storage bytes must match **both** recorded result size and SHA-256 before any response containing scientific data is returned. A mismatch produces HTTP 409 with no scientific object bytes.
- The downloadable format is explicitly allowlisted for pairwise alignment, MAFFT MSA, FastTree Newick, sequence insights and protein properties; content disposition is derived from trusted IDs rather than object names.

A matching checksum detects unintentional or unauthorized changes relative to trusted job metadata. It does not independently prove scientific correctness, producer identity, or that source data was authentic. Independent biological validity stays with worker-side scientific result validation.

## Test and release

```sh
cd apps/web
node --experimental-strip-types --test tests/scientific-result-integrity.test.mjs
npm run typecheck
npm run build
```

GitHub CI runs the tamper regression suite on web changes. The tests cover all five result formats, wrong-tenant paths, wrong job and artifact names, unexpected states and types, invalid digests, excess sizes, corrupted bytes and verified matching bytes.

This is a source-code milestone; production deployment and any Supabase migration are out of scope. No browser preview is needed.
