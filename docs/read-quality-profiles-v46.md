# Genithm V46: complete-file read-quality profiles

## Implemented scope

V46 extends the V44/V45 managed single-file and ordered paired-FASTQ verifiers.
It does not create a new workspace, change the approved desktop light theme,
or substitute language-model output for scientific computation.

Every valid FASTQ record contributes to base-quality profiles, read-length
counts, a mean-read-quality histogram and a per-read GC histogram. Both mates
have separate profiles. All stored-source bytes must still pass whole-object
SHA-256 verification before the fenced worker publishes a result. Plain FASTQ,
gzip and concatenated gzip members use the same strict four-line scanner.

No sequencing identifiers, raw sequences, qualities, barcodes, signed object
URLs, credentials or storage keys are present in the exported profiles. The
scanner retains a bounded batch while computing; it does not send reads to an
AI service. These reports contain sensitive project-derived aggregates and
remain owner/project permission protected.

## Exact statistical contract

* Phred+33 is assumed, not inferred from overlapping encoding ranges. Scores
  0 through 93 are accepted under the existing strict ASCII FASTQ contract.
* The first ten positions are individual cycles. Subsequent positions are
  pooled into fixed ranges: ten bases through 200, one hundred through 1,000,
  one thousand through 10,000, ten thousand through 100,000, one hundred
  thousand through 1,000,000, and a final range through 1,048,576. There are at
  most 65 ranges. The final displayed range ends at the actual longest read.
* A read contributes only at positions where it has a base. Each position range
  stores observed-base count, integer Phred sum, Q20/Q30 counts, A/C/G/T/N
  counts, and exact nearest-rank P10/P25/P50/P75/P90 of its pooled bases.
  Quantile rank is `ceil(n * percentile / 100)`, evaluated with integers.
  Information about individual positions inside a pooled range is not retained.
* Read lengths use those same fixed ranges, with exact read counts per range.
* Mean-read-quality histogram: arithmetic mean Phred score, rounded down to
  an integer; each read is counted once. This is not an error-probability mean.
* Read-GC histogram: `floor(100 * (G+C)/(A+C+G+T))`, excluding N. All-N reads
  are counted separately as undefined, never interpreted as zero-percent GC.
* No read sampling, arbitrary early truncation, FastQC flags, adapter detection,
  trimming, alignment, contamination diagnosis or biological pairing proof.
  Pooled descriptive summaries are not FastQC output or clinical validation.

NumPy 2.3.5 is pinned for bounded integer histogram accumulation. A normal batch
contains at most 262,144 bases and 16,384 reads. One longer read can exceed the
normal batch size, but is immediately flushed and cannot exceed the existing
1 MiB per-read parser limit. Memory does not grow with the total read count.
Input-byte limits, expansion limits, deadlines, renewable leases, cancellation,
permission checks and source-identity checks remain in force.

## Report protocol and API

New single results retain `genithm-large-data-result/1` and identify the verifier
as `genithm-large-data/1.1.0`. The paired publication contract deliberately stays
`genithm-large-pair/1.0.0`, matching the V45 database RPC. Each embedded profile
identifies the new component as `genithm-read-quality/1.0.0` and uses schema
`genithm-read-quality-profile/1`. This distinguishes the new computation from
historical V45 results without rewriting their provenance.

New results contain a `report_sha256` over the canonical JSON result without
that field (sorted keys, ASCII escaping, compact separators, non-finite values
forbidden). This detects accidental changes; it is not a digital signature and
cannot protect against a privileged writer who replaces both data and digest.

Authenticated endpoints:

```
GET /api/v1/large-data/uploads/{uuid}/quality-report?format=json
GET /api/v1/large-data/uploads/{uuid}/quality-report?format=tsv
GET /api/v1/large-data/pairs/{uuid}/quality-report?format=json
GET /api/v1/large-data/pairs/{uuid}/quality-report?format=tsv
```

Each call authenticates and invokes the existing owner/project-authorizing
get RPC before reading the report. Paired endpoints also retain their explicit
feature gate. Responses validate the digest, schema, source binding and
aggregate invariants; failed consistency returns 409 without partial metrics.
They send `Cache-Control: no-store`, `X-Content-Type-Options: nosniff` and an
attachment filename containing only a server UUID. TSV contains fixed headings
and validated numeric values, not user-entered filenames or read identifiers.

Overview and status responses retain the old aggregate fields, strip the new
arrays, and provide `quality_profile_available`. Opening the existing Data-page
disclosure fetches the full report; there is no browser persistence or automatic
polling. JSON/TSV exports make a new authenticated request. Both charts and
scrollable exact-data tables use the same returned values. Plotted position
and length ranges are equally spaced and explicitly not drawn to scale.

Old completed reports stay readable as aggregates. They are never silently
backfilled; the UI states that their verifier did not record detailed profiles.
Generating new profiles requires a new authorized verification job/input flow,
not resubmitting browser-supplied numbers. Historical completed paired reports
can be exported after source cleanup, while clearly marking unavailable sources
and not granting permission to reuse them.

## Deployment boundary

No migration, live database change, credential change, quota change, storage
provisioning or paid compute activation is part of V46. Existing V44/V45 schemas
are reused, including their 64 KiB JSONB report ceiling. Deploy the matching API,
web build and both verifier processes together after testing. If V45 has not
been activated, its migration and separately enabled paired worker still need
operator activation; this feature does not silently perform it.

The V43 release candidate and existing scientific executors are unchanged.
The 100 GiB policy ceiling is not measured 100 GiB capacity. All capacity claims
must name the actual revision, complete inputs, worker memory and environment.

## Verification included in source

The local API suite covers independent reference calculations over 100 seeded
variable-length cases, batch boundaries, Phred/GC extremes, all-N reads, long
reads, gzip members, report corruption, malformed metrics, authentication,
owner isolation, legacy handling and optimized-Python validation. Node checks
cover opt-in rendering, authenticated export, cleanup and scientific labels.

`tests/large_data` adds real isolated PostgreSQL/S3 round trips, unauthorized
and revoked access, checksum tampering, historical pair exports and all 65
position/length ranges through actual uploads and both workers. Complete 1/5
GiB single-source and 1+1 GiB paired acceptance now asserts the full new profiles,
not only old aggregates. Results are uploaded by the managed-data workflow.

The real-route Playwright suite adds single/paired report loading, four views,
exact tables, authenticated JSON/TSV downloads, explicit failure/retry, legacy
and historical-source states, accessibility scans and screenshots. Its auth/data
responses are synthetic isolated UI fixtures, not production backend evidence.
Real database/storage acceptance is a separate suite. Tests in source are not
claims that a particular CI run has passed; consult that run's artifacts.

Primary methodological references consulted during development:
- https://www.bioinformatics.babraham.ac.uk/projects/fastqc/Help/3%20Analysis%20Modules/2%20Per%20Base%20Sequence%20Quality.html
- https://numpy.org/doc/stable/reference/generated/numpy.bincount.html
- https://pypi.org/project/numpy/2.3.5/
