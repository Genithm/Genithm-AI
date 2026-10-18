# V45: managed paired-end FASTQ checks

This extends the existing V44 Data-page large-file path. It is a complete **ordered
R1/R2 correspondence and aggregate-QC check**, not an aligner, read merger,
transcript quantifier, differential-expression engine, or clinical analysis.

## Actual execution

1. Upload and finish individual FASTQ or FASTQ.gz verification using V44.
2. Open **Data > Large files > Check paired-end data**. Select two ready files
   owned by the current researcher in the same project and approve the check.
3. The authenticated API derives identity from Supabase Auth. Database admission
   captures source IDs, hashes, byte lengths and object ETags; none comes from the
   browser's assertions. Existing enabled project allowance and a fresh paired
   worker heartbeat are required. Two active paired jobs per project and ten new
   jobs per researcher/project/hour bound admission. A scoped request UUID is
   idempotent; the reversed order is a distinct scientific request.
4. A dedicated process claims one job with a renewable five-minute fenced lease.
   Both private objects are conditionally read by ETag; every compressed byte is
   SHA-256 checked and every expanded FASTQ record is validated. The streams are
   consumed in lockstep with bounded buffers, not loaded into memory or sampled.
5. R1/R2 counts and normalized identifiers must correspond at every record.
   `/1` and `/2` suffixes and conventional Illumina `1:N:0:...` / `2:N:0:...`
   annotations are supported. Explicit wrong/conflicting mate numbers reject the
   run. Plain identifiers are matched by order but **do not demonstrate mate
   orientation**. Both categories are counted separately in results.
6. The worker checks object identity again before publishing. Source records,
   permissions, project status and current lease are rechecked in the database.
   Success includes per-file counts, base composition, GC excluding N, mean Phred,
   base-level Q20/Q30 and read-length summaries. Phred+33 is assumed, not inferred.
7. An owner-authenticated no-store TSV export retains job, source and canonical
   result fingerprints. Result tampering is rejected. Export does not re-download
   genomic files: source attestation describes the objects scanned during execution.

## Integrity and privacy

- No source sequences, read identifiers or per-read quality strings are saved in
  pairing metadata or returned by the API. Even mismatch errors omit read IDs.
- Every input byte and pair is checked. **Read identifier uniqueness is not checked**;
  repeated equal identifiers are not proof that two records are biological mates.
- Both raw and concatenated-gzip streams are supported, including different
  compression on each mate. Invalid CRC/trailers, interrupted streams, mismatched
  checksums, unsupported symbols and malformed records fail without partial results.
- Source deletion through Genithm is blocked while a dependent job is queued/running.
  Cancellation clears its fencing token immediately; a worker stops at its next
  cancellation/lease check and cannot commit success. Closing a browser is not cancellation.
- Expired jobs may restart from their sources, at most three claims. This is **not
  mid-algorithm checkpoint/resume**, nor does it make gzip randomly seekable.
- Native S3 ETags are identity conditions, never substituted for whole-file SHA-256.
- The new tables and eight public RPCs deny anonymous/authenticated direct access.
  Only the backend service role calls them after authenticating the actor; read and
  write project permissions remain enforced by the functions.
- No quotas, credentials, bucket, paid machine, production feature flag or worker
  process are provisioned by the migration.

## Resource limits and deployment

Retain V44's 100 GiB/source admission ceiling, 1 MiB/read and 4 KiB/header bounds.
The paired scan has one hour total and the configured decompression budget **per
mate** (V44 default 200 GiB). A policy ceiling is not demonstrated capacity.

After schema review and matching API-image publication, explicitly set
`GENITHM_LARGE_DATA_PAIRS_ENABLED=true` on the API and new worker. The usual V44
private storage/auth environment is also required. Start the optional process:

```sh
python -m app.large_data.paired_worker
```

Use one paired worker initially; provision CPU/RAM intentionally and measure the
real target storage path. Existing V44 verification continues in its own process.
The original six-worker readiness contract is unchanged. The paired worker's
own heartbeat gates admission. Do not enable the API flag before the migration
and worker exist. No public HTTP endpoint or storage account keys go into clients.

## Acceptance evidence

Unit tests compare hand-calculated inputs and 150 seeded independent references.
Integration tests use actual PostgreSQL functions, an actual S3-compatible server
and production API/worker code. Auth is a loopback fixture, not live Supabase Auth.
They test access isolation, input pinning, cancellations, fenced retries, queue
admission, corrupt result refusal, gzip, and two physically allocated 1 GiB files.
The larger fixture has 4,194,304 unique synthetic identifiers and 100-base reads in
each file. The full paired worker is measured in a fresh process. It must produce
exact expected counts, source hashes and quality metrics, with peak RSS below
300 MiB. Publish actual time and memory only from completed CI artifacts.

Browser tests exercise real application components against an isolated API fixture:
explicit open, selection, approval, status refresh and TSV download. They do not
prove Internet upload speeds or a live multi-GB desktop-to-provider journey.

## Primary format references, consulted 2026-10-18

- https://help.connected.illumina.com/basespace-sequence-hub/files-used-by-basespace/fastq-files
- https://support.illumina.com/content/dam/illumina-support/help/BaseSpace_Sequence_Hub_OLH_009008_2/Source/Informatics/BS/UploadFastqReq_swBS.htm
- https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-reads.html
