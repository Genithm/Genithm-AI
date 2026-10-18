# V44: managed large-data upload and complete server FASTQ QC

The approved Genithm desktop UI is preserved. An expandable panel on the existing Data page
connects authenticated users to a new private multipart control plane. This is not just an
operator script or a new upload-size constant. Storage is opt-in and every project must have
an explicitly configured allowance. Existing small-file workflows are unaffected.

## Path through the real application

1. A dedicated browser Worker hashes the selected file in 4 MiB slices. Only the file digest,
   size, format, project and filename enter the API's bounded metadata request.
2. Supabase Auth verifies the current bearer token. Service-only PostgreSQL functions check
   active organization/project membership and write role. A per-project row lock reserves bytes
   atomically. An idempotency key binds the exact request, preventing duplicate quota charges.
3. The server chooses an immutable-per-session quarantine key. Each short-lived signed URL
   authorizes exactly one 64 MiB (or smaller final) part with a bound Content-Length. No raw file
   passes through Next.js or FastAPI. Two browser transfers at most run concurrently.
4. Pause/reload/reselect the identical file to resume. The server lists actual provider parts;
   acknowledged part geometry is checked and reused. The whole source hash must still match.
5. Completion uses provider receipts and exact part lengths, not browser assertions. Exclusive
   operation tokens prevent simultaneous complete/abort. An uncertain completion remains
   quarantined until HEAD reconciliation; it is not blindly reported successful.
6. A separate worker claims the durable verification queue with a renewable, fenced lease.
   It checks private object identity/ETag and reads every source byte, keeping a bounded buffer.
   For FASTQ or FASTQ.gz it parses every record and calculates actual aggregate QC in the same
   pass. Decompression, line size and execution time are bounded. No sampled metrics are labelled
   as complete results. Source size and whole-object SHA-256 must match before publication.
7. The Data page displays the stored state and real aggregate result. Opaque files are labelled
   byte-verified only, NOT biological-analysis complete. Removal releases quota only after
   confirmed provider cleanup, never merely after a browser cancel button.

## Scientific scope

FASTQ/gzip: complete read/base counts, min/max/mean read length, A/C/G/T/N composition,
GC excluding N, mean Phred and base-level Q20/Q30. Phred+33 is assumed and must be confirmed
by the researcher. Four-line records only, up to 1 MiB per read and 4 KiB per header.
No read names/sequences or individual quality strings are returned as metadata. Gzip CRC/trailer
errors, incomplete objects, wrong whole-file hashes and oversized decompression fail closed.
The verifier accepts a planned ceiling of 100 GiB/source, but actual demonstrated sizes must
be reported from test artifacts. No claim is made for every format/tool at this ceiling.

Not included: paired-file matching in the GB worker, reference-guided alignment, BAM indexing,
variant calling, count-matrix statistics, resume within a partly scanned gzip stream, or a complete
RNA-seq pipeline. An interrupted verification re-reads its immutable source under a new lease;
upload resume and scientific task checkpoint/resume are distinct capabilities.

## Security and failure model

API derives the actor from Supabase Auth, never from request fields. Service RPCs are executable
only by service_role, with explicit actor/project checks and empty search paths. Public/anon/user
roles cannot modify reservations, quota counters, provider identity, verifier state, leases or results.
Direct table access is revoked, RLS is enabled, and API responses omit object keys, provider upload
IDs and operation tokens. Opaque ETags are not treated as file checksums. Signed URLs are short-lived
capabilities and never logged or persisted in browser storage. They are not instantly revocable.

Failed initialization deliberately retains quota and cannot be retried blindly. After an operation
settlement window it can be cleaned by exact key. Expired verification attempts may be re-claimed;
old tokens cannot update progress or publish results. Three exhausted leases become an operator-visible
failure, not an infinite retry loop. Provider outages and checksum failures are not converted into
successful empty results. No free-space reservation or database quota guarantees provider billing.

## Source references (consulted October 2026)

- https://developers.cloudflare.com/r2/api/s3/api/ (implemented multipart and checksum features)
- https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpuoverview.html (part identity, completion and abort)
- https://docs.aws.amazon.com/AmazonS3/latest/userguide/checking-object-integrity-upload.html (ETag caveat)
- https://supabase.com/docs/guides/database/functions (privileges, definer scope, actor checks)

## Delivery

Read-only test workflow runs the actual API/router/storage/worker against isolated PostgreSQL,
a real S3-compatible server and an isolated HTTP auth fixture. This is not a live Supabase Auth
or real Internet/cross-origin acceptance test. A fresh worker subprocess measures the 1 GiB
synthetic FASTQ run; the input is fully written, not sparse. Test evidence records exact bytes,
source/server hashes, read counts, resume parts, elapsed times and peak worker process RSS.

See deploy/large-data/README.md for opt-in prerequisites. Do not claim the feature is active merely
because source has merged or a migration exists. No production budget, bucket or compute is enabled
by this commit. V43 RNA-seq and the earlier operator-transfer ZIP remain separate candidates.
