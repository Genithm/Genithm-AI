# Genithm V47: universal private bioinformatics file intake

This release extends the existing desktop/light Data page and adds the same
project-scoped uploader behind the chat composer's **Research files** button.
It is a working upload/integrity feature, not a claim to perform every analysis.
No uploaded file is automatically supplied to the language model by this feature.
Existing sequence/image chat attachments remain separate.

## Implemented contract

* Any nonempty file can be uploaded within the existing project quota and per-file
  ceiling, regardless of suffix or MIME type. No extension allowlist is used.
* A versioned name catalogue covers sequencing, alignments, annotations, variants,
  indexes, genome graphs, population genetics, single-cell/spatial, structures,
  chemistry, proteomics, instrument signals, tables, workflows and archives.
  Ambiguous names such as BED and MAP are labelled; names are not validation.
* Up to 100 files per selection; folder relative paths and batch IDs persist.
  File transfers are sequential, with at most two 64 MiB PUT parts concurrently.
  Hashing uses bounded slices in a dedicated browser worker. Confirmed provider
  receipts, not browser progress, decide which parts can be reused.
* Same-selection retries reuse request IDs and reserved source identities. A
  failed transfer stops the batch and its peer PUT. Closing a panel stops browser
  work. After tab loss, select the saved upload in the paginated library and
  supply the identical local file to resume. Unstarted selections are not saved.
* Owner/project-scoped keyset pagination makes files older than the former
  30-row overview reachable. Source paths never become object-storage keys.
* Complete stored-object SHA-256 and byte count verification for every accepted
  file. Bounded 64 KiB header hints are labelled, never represented as a complete
  format check. JSON file reports verify checksums and semantic invariants.

## Scientific inspection is explicit

Auto mode uses complete existing FASTQ QC for FASTQ/FQ, plain or gzip/BGZF aliases,
and adds a complete streaming FASTA structural scanner for FASTA/FA/FNA/FAA/FFN/
FRN/FAS/FSA, plain or gzip/BGZF. It handles wrapped and unwrapped records,
concatenated gzip streams, and an absent final newline. It reports record/symbol
counts, length statistics and counts of A-Z, star, dash and dot. Sequence spaces,
tabs and CR are ignored; LF delimits lines. Headers must be nonempty UTF-8, at most
4096 bytes. DNA/RNA/protein identity is not inferred; duplicate IDs are not checked.
Existing FASTQ Phred+33 assumptions and strict four-line dialect remain unchanged.

Invalid input, changed objects, corrupt compression, excessive expanded data,
time limits, cancelled ownership or incorrect full checksums cannot yield a
successful inspected report. Auto inspection never silently falls back to bytes.

**Preserve bytes only** explicitly disables FASTA/FASTQ parsing for unsupported
dialects and archival uses. Other formats, including BAM/CRAM/BCF/H5AD/POD5/mzML/
RDS and arbitrary proprietary extensions, always receive integrity-only storage
in this milestone, not full format validation, alignment or biological analysis.

Archives are never extracted; scripts/notebooks are never executed; serialized
objects are never deserialized; uploaded documents are not rendered. No malware
scanner is included. A correct checksum does not certify that a file is safe.
Compressed formats other than gzip/BGZF FASTA/FASTQ remain opaque, without decoded
validation. Directory-based datasets preserve selected file paths, not empty
folders, symlinks, filesystem permissions or an atomic multi-file transaction.

## Database and compatibility

The additive migration adds intake_mode, relative_path, batch_id, pagination and
batch uniqueness indexes, and a separate worker-capability marker. New jobs
require fresh V47 worker readiness. Old workers claim only legacy jobs; a V47
worker supports legacy and modern jobs. Legacy data and reports are not backfilled
with fabricated metadata. RLS and service-only RPC grants remain in force.
Project permissions are rechecked before modern result publication and export.
The V44 three-active-upload project/researcher limit still applies; a batch stops
with a visible admission error rather than overrunning it. Completed file upload
is not worker completion. Restarting an interrupted scan is not scientific
checkpoint-resume. All files in a batch independently consume existing quota.

Apply the existing V45 paired migration and the new V47 migration in repository
order, deploy the matching API/web revision, and run:

```sh
python -m app.large_data.worker
```

The existing private S3-compatible endpoint, exact-origin CORS, scoped credentials,
GENITHM_LARGE_DATA_ENABLED gate and approved project storage allowances are still
required. Paired checking has its own worker and flag. No bucket, credentials,
quota, paid machine or storage is provisioned by these migrations. Applying SQL
or merging source does not by itself start a worker or deploy a hosted application.

## Verification and capacity

New tests cover all registered suffixes, independent seeded FASTA calculations,
long unwrapped input with bounded allocations, hostile metadata, checksum and
semantic tampering, retry identity, cancelled peers, genuine browser transfers,
real PostgreSQL/S3 isolation, old-worker gating, pagination past 30 records,
permission revocation, and complete physically allocated 1 GiB FASTA acceptance.
The previous 1/5 GiB FASTQ and 1+1 GiB paired checks are retained. Test results and
benchmarks are reported separately after execution. A 100 GiB policy ceiling is
not tested 100 GiB capacity. Browser tests use isolated fixtures, while backend
acceptance uses real local PostgreSQL and S3-compatible storage with fixture auth.

Primary design references: HTS specifications (https://samtools.github.io/hts-specs/),
Supabase grants/RLS (https://supabase.com/docs/guides/api/securing-your-api), and
OWASP File Upload Cheat Sheet (https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html).
