# Managed large data (V44) deployment gate

This is an opt-in extension, NOT enabled by a normal preview restart. It leaves the existing
50 MiB FASTA and local FASTQ/VCF labs unchanged. Use Data -> Large files for the new path.

Prerequisites: merged/reviewed schema; a dedicated PRIVATE S3-compatible bucket in the same
region as compute; an HTTPS S3 API endpoint (not a public bucket URL); compatible CORS;
server-side scoped credentials; one independent verifier process; explicit project quotas.
A policy ceiling is not a demonstrated cloud capacity or scientific-workflow limit.

API and verifier environment (never NEXT_PUBLIC):

```
GENITHM_LARGE_DATA_ENABLED=true
GENITHM_LARGE_DATA_ENDPOINT=https://<private-s3-api-origin>
GENITHM_LARGE_DATA_PUBLIC_ENDPOINT=https://<browser-reachable-s3-api-origin>
GENITHM_LARGE_DATA_BUCKET=<dedicated-private-bucket>
GENITHM_LARGE_DATA_ACCESS_KEY_ID=<scoped-server-key>
GENITHM_LARGE_DATA_SECRET_ACCESS_KEY=<scoped-server-secret>
GENITHM_LARGE_DATA_REGION=auto
GENITHM_LARGE_DATA_MAX_EXPANDED_BYTES=214748364800
```

Use `us-east-1` (or the configured region) for S3-compatible deployments that require it;
R2 uses `auto`. Both endpoints must address the same bucket. HTTPS is mandatory in deployed
configuration. Tests alone construct explicit loopback HTTP configuration. API and verifier
also use the existing Supabase server configuration. Do not grant browser users bucket keys.

Run a dedicated verifier using the same reviewed API image:

```
python -m app.large_data.worker
```

A production process manager/container restart policy is required. Set a CPU allocation
and at least 512 MiB RAM; adjust only after workload measurement. The default verifier has
one job at a time, a five-minute fenced lease renewed during reads, a one-hour task deadline,
and no unbounded in-memory file loading. A fresh heartbeat is required for NEW reservations.
Idle worker heartbeats occur every 30 seconds; shutdown stops work and leaves a recoverable lease.
This seventh optional process does not silently alter the existing six-worker runtime contract.

Configure each project quota administratively, using the actual project ID after a read:

```sql
-- Illustrative only: select an authorized project's real id; review cost first.
insert into public.large_data_project_limits(project_id,enabled,capacity_bytes,max_file_bytes)
values (:project_id,true,:approved_capacity_bytes,:approved_per_file_bytes);
```

The migration creates NO quota rows and allocates NO cloud storage or machines. A quota is
logical reserved/stored source bytes, not a cloud-provider spending limit. It excludes provider
replicas, multipart overhead, egress, derived artifacts and compute. Aborted/rejected work keeps
its allowance until physical cleanup is confirmed. Keep a bucket lifecycle rule to expire orphan
multipart uploads and run an operator sweep for reserved/initializing sessions that were abandoned.
Never reduce a capacity below charged bytes. No ordinary account can raise its own allowance.

CORS: allow only the exact Genithm desktop origin, PUT, and required headers. Do not use wildcard
origins or public bucket access. The API signs Content-Length and a single part number/object key
for 300 seconds. Existing signed URLs remain capabilities until expiry; membership revocation
stops issuance of new URLs but cannot instantly recall an already issued URL. Pause transfers
before cleanup; the API waits for expiry plus 120 seconds and refuses cleanup during completion
or verification. Provider lifecycle cleanup remains a requirement for delayed/orphan parts.

Validation BEFORE enabling production:
- Real provider TLS, CORS, signature/part-size enforcement, private IAM, cleanup/lifecycle tests.
- Live authenticated end-to-end flow including expired/revoked user sessions and two tenants.
- Provider-specific interrupted completion, in-flight abort, verifier death/lease recovery.
- Actual chosen sizes (10/50/100 GiB) and representative compressed sequencing datasets.
- Matching source hashes and independently calculated scientific metrics; storage/cost limits.
- Real desktop browser at the deployed origin; provider speed and failure/retry observations.

No arbitrary uploaded BAM/CRAM/VCF file is routed to an existing small-input scientific executor.
Opaque inputs receive byte verification only. FASTQ/gzip receives full aggregate QC (Phred+33
assumed, four-line layout, A/C/G/T/N). Paired-read matching, alignment, variant calling, DE analysis,
and downstream use require their own versioned executor integration and resource admission.


## Optional paired-end extension (V45)

After applying the reviewed V45 migration, set `GENITHM_LARGE_DATA_PAIRS_ENABLED=true`
on the API and a separate paired worker. Start `python -m app.large_data.paired_worker`
with the same private bucket/auth settings. No worker is automatically provisioned.
The existing verifier and original six workers remain separate. See
`docs/managed-paired-fastq-v45.md` for admission, cancellation, source-retention and
complete-pair scientific limits. Matching two files is not RNA alignment or DE.
