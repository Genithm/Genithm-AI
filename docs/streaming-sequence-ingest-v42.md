# Genithm V42: faster scientific data ingestion

This release keeps the approved desktop/light workspace. It optimizes the
existing server-side FASTA upload path used by downstream scientific analyses.
It does not add a decorative lab or claim new whole-genome/RNA-seq capabilities.

## Actual implemented change

Previously, the production upload worker read the entire object, decoded it,
validated it, then called statistics code which validated and decoded it again.
That path scans the data three times and creates full-file strings and line lists.

The new production path requests at most 64 KiB per read from either private
Supabase Storage or configured R2/S3-compatible storage. A strict incremental
UTF-8 decoder and bounded-fragment FASTA scanner calculate validation, aggregate
statistics and the raw-object SHA-256 together. Even a single unwrapped sequence
line is processed incrementally. The scanner retains counters, bounded header
text, and up to 100,000 SHA-256 header fingerprints for duplicate warnings, not
whole sequences or raw headers after their line ends. Memory is bounded by the
fixed chunk/header sizes and the existing maximum record count; it is not
claimed to be constant with an unlimited number of records.

The existing validator/statistics functions remain as independent reference
implementations and byte-client compatibility APIs. Production uses
`SupabaseRuntimeClient.inspect_input`, not the old full-download path.

## Scientific and security invariants

- Existing 50 MiB file, 100,000-record and 1,000-character header bounds remain.
  No previously rejected large upload is suddenly admitted to downstream tools.
- Valid-input classification, warnings, composition, frequencies, min/max/mean
  record length, gap counts and GC definitions remain compatible. GC uses the
  original canonical A/C/G/T/U denominator. No sampled or approximate statistics.
- Unicode/BOM, CRLF and all Python splitlines boundaries work across chunk edges.
- Exact declared transfer size is checked. Truncated, oversized or disconnected
  transfers cannot produce successful scientific metadata or a trusted prefix hash.
- On a scientific-format rejection, the size-bounded stream is drained before
  emitting a full raw-object digest. UTF-8/NUL failures are still rejected.
- Storage streams close on success, rejection and transfer error. No raw FASTA
  content is added to logs, database rows or test artifacts.
- Existing authorization, queue claim and completion RPCs stay unchanged.
  Worker runtime version is 0.3.0; validator/statistics result schemas remain
  unchanged. Duplicate-header comparison uses collision-resistant SHA-256.

## Evidence and reproducibility

The suite compares against the original reference on hand-calculated data,
700 seeded DNA/RNA/protein fixtures, byte-sized UTF-8/line splits, long headers,
long unwrapped lines, invalid files, actual loopback HTTP transfer and private
R2 body interfaces. It also checks bounded read requests and bounded allocation.

```
PYTHONPATH=apps/sequence-worker pytest -q apps/sequence-worker/tests
PYTHONPATH=apps/sequence-worker python apps/sequence-worker/tests/benchmark_ingest.py --mib 16
PYTHONPATH=apps/sequence-worker python apps/sequence-worker/tests/benchmark_ingest.py --mib 8 --unwrapped
```

The benchmark creates a clearly synthetic file, runs legacy and streaming paths
in fresh processes, and requires identical serialized scientific results and
input hashes. It reports wall time and peak whole-process RSS without asserting
an unrealistic timing SLA. Network transfer, queue wait, multi-user load and
whole analysis completion times are not measured. CI uploads raw measurements.

## Activation

The coordinated release generation advances to 9 so the matching runtime images
can be published through the existing release pipeline after merged-main checks.
Source merge or image publication alone does not restart a running Codespace.
Do not activate a partially published candidate. After publication, use the
existing full launcher. No database migration, new cloud machines, GPU purchase,
secret change, or modification to existing research data is needed.
