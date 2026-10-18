# Genithm V44: multi-gigabyte transport foundation

## Scope: a tested backend building block, not a new customer size-limit claim

The current authenticated FASTA UI/API limit remains **50 MiB**. Local FASTQ and
VCF QC limits are also unchanged. This change does NOT pretend that storing a
file means every scientific workflow can analyze it. V43's separate RNA-seq
candidate is not silently merged or activated here.

New internal modules `app.bulk_transfer` and `app.bulk_s3` provide a real
multipart data-transfer engine for trusted background ingestion processes.
There is deliberately **no public HTTP route, automatic bucket creation, new
Supabase schema, or UI button** until project quota reservations and durable
job ownership/fencing are integrated and tested end-to-end.

## What is implemented

- A size policy up to 100 GiB with a bounded, lazy multipart plan. Default parts
  are 16 MiB; one to four concurrent uploads are allowed. Per-part size is bounded
  to 5-64 MiB and the plan never exceeds 10,000 parts. The 100 GiB policy ceiling
  is arithmetic/configuration support, not a benchmark of every possible size.
- Complete source SHA-256 and ordered part hashes, obtained in 1 MiB reads. The
  source is never read into one file-sized buffer. Before each upload the bytes
  of that part are rechecked against the initial source fingerprint.
- A crash-resistant checkpoint written atomically with file and directory fsync,
  0600 permissions, and local-process exclusion. It stores metadata and hashes,
  not read sequences, file contents, credentials or signed URLs.
- Scope binding to organization/project/owner/dataset UUIDs and configured
  storage endpoint+bucket. Resume rechecks the WHOLE source and compares durable
  part acknowledgements with authoritative paginated S3 ListParts responses.
  Already acknowledged intact parts are skipped; unacknowledged writes may be
  retried. File-size/mtime matching alone is never accepted as source identity.
- Real S3/R2 multipart create, part upload, listing, completion and abort. Each
  part uses Content-MD5 for transport integrity. Multipart ETags remain opaque:
  they are never treated as a full-file SHA-256 or biological validation.
- Final conditional GET and SHA-256 of every stored byte before returning a
  transport receipt. Truncation, oversized reads and byte corruption fail closed.
- SDK automatic retries must be disabled. Only transient, idempotent part PUTs
  are retried by the engine. Lost completion acknowledgements are reconciled
  by observing and hashing the completed object; uncertain completion is not
  blindly repeated. Unresolved ambiguity requires operator reconciliation.
- Streams close on error/success; abort never deletes already stored objects.

## Mandatory integration contract

`Scope` is NOT authentication. A production caller must first validate the
current user's project access, reserve quota and a unique dataset object key,
then hold a durable fenced ownership lease before invoking the core. This
module assumes checkpoint files are trusted, private server-side state; never
accept an uploaded checkpoint from a browser as authorization. Local file locks
are not a distributed lock. Do not schedule two workers for one target.

The configured S3 client must use operator-controlled endpoints/credentials;
none are taken from a checkpoint. Only HTTPS is accepted except explicitly
allowed loopback HTTP in isolated tests. Credentials must be bucket/prefix
restricted. The engine does not provision storage, modify IAM/CORS, set public
ACLs, bypass existing upload limits, or assign scientific jobs.

A resumable browser facade still needs authenticated session creation, per-part
short-lived access, immutable size/source identities, quota enforcement, secure
restart/cancel semantics, and pending-transfer lifecycle cleanup. Large FASTQ,
BAM/CRAM/VCF and count matrices need format-aware validators and compatible
background executors. Generic byte verification is not those validators.

A service may label an imported dataset **bytes verified / awaiting format
validation** after this module succeeds. It must not mark it analyzed, clinically
validated, or compatible with every existing executor.

## Verification and acceptance criteria

Unit/contract tests exercise real disk-backed part writes and full reads, plus
SDK stubs for MD5, conditional GET, paginated listings and access-denied handling.
Cases include interrupted uploads, changed source content with preserved size
and timestamp, lost completion responses, corruption, scope changes, invalid
checkpoints, retry limits and stream cleanup.

`Large dataset transport capacity` CI starts the same digest-pinned S3-compatible
SILO image used by the repository's existing preview tests. It writes a full
non-sparse **2 GiB synthetic file**, uploads two parts, injects interruption,
resumes, completes the object, GETs and hashes all bytes, and compares the result
with an independently computed source hash. It asserts no acknowledged part was
retransmitted and client peak RSS stays below 512 MiB on that runner. No user or
production data or credentials are used. Temporary objects and containers are
removed. Artifacts contain measurements only, not payloads.

This is a **loopback storage transport test**, not a WAN upload benchmark, R2
production deployment, simultaneous cohort load test, or a scientific algorithm
benchmark. Client RSS excludes storage-server memory. Full-file source and
verification passes cost I/O and must not be omitted to inflate reported speed.

Before enabling gigabyte-sized uploads in the main app, acceptance must cover:
1. Resume across browser and worker restarts with revoked-access and quota tests.
2. A live authorized 1/10/100 GB dataset journey on configured staging storage.
3. All-byte format validation and a compatible server-side scientific workflow.
4. Real cancellation, recovery, encrypted private storage and cleanup.
5. Upload, queue, compute, validation and report timings measured separately.

## Primary protocol references checked 2026-10-18

- Cloudflare R2 upload methods and part limits:
  https://developers.cloudflare.com/r2/objects/upload-objects/
- R2 S3 compatibility (Content-MD5, conditional GET, multipart behavior):
  https://developers.cloudflare.com/r2/api/s3/api/
- Boto3 UploadPart contract:
  https://docs.aws.amazon.com/boto3/latest/reference/services/s3/client/upload_part.html

These upstream limits are not a promise of Genithm end-to-end capacity. Compute
RAM, CPU/GPU, temporary disk, storage budget, references and scientific method
must be sized for the actual analysis. Supabase remains the authorization/job/
metadata control plane; large file bodies belong in private object storage.
