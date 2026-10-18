# Genithm V45: complete managed paired FASTQ validation

## Shipped code, deliberately limited scientific scope

The existing Data page's managed large-file disclosure gains a nested **Paired-end
verification** control. Select two **ready** FASTQ or FASTQ.gz uploads from the same
researcher and project. The server creates a durable, idempotent job; a separate
worker rereads both immutable stored objects, recomputes both whole-file SHA-256
hashes, validates every FASTQ record, and compares every identifier pair in order.
No raw reads or identifier strings enter the response or persistent result.

This is not read mapping, assembly, RNA-seq quantification, variant calling,
sequence overlap merging, or proof that reads are biologically paired. It is a
necessary input-validation stage for those future workflows, not their replacement.

## Identifier and format contract

Four-line FASTQ, Phred+33 assumed, A/C/G/T/N sequences, up to 1 MiB per read and
4 KiB per header. Plain/gzip combinations and concatenated valid gzip members
are supported. Gzip errors and trailing corruption fail closed. Existing
V44 per-source byte and decompression limits remain; no size limit is increased.

Identifiers are compared **directly**, in order, not by a sample or aggregate hash.
The first whitespace-separated identifier may end in `/1` or `/2`; the second
field may use documented Illumina `1:N:0:INDEX` / `2:Y:18:INDEX` notation. Matching
explicit markers must say R1 for the first file and R2 for the second. Contradictory
suffixes, malformed mate fields and reversed mates are rejected. Unrecognized
`.1` / `.2` suffixes are not guessed away. Read identifiers are case-sensitive.

Bare identical identifiers are accepted as ordered consistency, but the result
reports unlabeled/partially labeled pairs separately. Identical source-file hashes
produce an explicit warning. Identifier uniqueness across the dataset is **not**
checked: no unbounded set of read names is retained. Mate-role labels do not imply
physical strand orientation or experimental validity.

Source documentation consulted 2026-10-18:
- https://www.ncbi.nlm.nih.gov/sra/docs/submitformats/ (paired order and supported markers)
- https://support.illumina.com/content/dam/illumina-support/help/BaseSpace_Sequence_Hub_OLH_009008_2/Source/Informatics/BS/UploadFastqReq_swBS.htm

## Authorization, lifecycle and reliability

- API derives the user from the existing bearer-token Auth check. No actor,
  bucket, storage path, expected checksum or computed metrics are accepted from
  the pair form. SQL rechecks owner, write role, active project, ready source
  states, common storage identity and a live paired verifier.
- Service-only RPCs and RLS tables; anonymous/end-user SQL access is denied.
- Atomic request ID reuse and two active pairs per owner/project. Already stored
  sources are not duplicated or charged twice. Limits are not billing guarantees.
- Five-minute leases, renewed during reads. Old or cancelled attempts cannot
  update or publish; project membership is rechecked on progress and completion.
- Three expired attempts exhaust the job. Interrupted scientific verification
  restarts from source beginning under a new lease, NOT a resumable alignment.
- Queued/running pairs block source object removal. Explicit cancellation revokes
  the lease, after which normal V44 cleanup rules apply. Ready historical reports
  remain readable if source uploads are later removed; `sources_available` reflects
  source record state, not a fresh object-store HEAD. A downstream workflow must
  independently recheck source bytes and permissions.
- Errors have fixed sanitized codes. No raw read names, private object keys,
  provider receipts or lease tokens are returned to the UI.

## Opt-in activation (not performed by source merge)

Apply the reviewed additive V45 migration after the V44 schema. Keep the existing
private object storage, CORS, Supabase server configuration and project allowance.
Set `GENITHM_LARGE_DATA_PAIRING_ENABLED=true` **only** on the API and dedicated
paired worker, in addition to existing V44 server configuration. Run:

```sh
python -m app.large_data.pair_worker
```

The process uses the same reviewed API package/container, one job at a time.
Allocate compute and at least 512 MiB RAM initially; measure representative data.
The deadline is two hours; each source retains its configured expanded-byte bound.
The migration provisions no bucket, quota, cloud machine or automatic enablement.
A large-data upload verifier heartbeat cannot substitute for a paired-worker heartbeat.
Do not enable a button or loosen admission merely because an optional worker is offline.

## Acceptance evidence

Local tests include hand-calculated metrics, both checksum failures, cancellations,
corrupted gzip, strict pair order, ambiguous labels, source-handle cleanup, and 150
seeded independent two-mate numerical comparisons (300 synthetic files).

CI exercises actual production API, SQL, storage and paired-worker functions using
isolated PostgreSQL/S3 with a loopback authentication fixture. It tests authorization,
concurrent admission, cancellation/lease fencing, source cleanup races, lost leases
and whole source replacement. A full acceptance case physically writes **1 GiB R1
and 1 GiB R2**, with 8,388,608 unique identifiers, uploads/resumes each source,
performs the existing single-source verification and runs paired validation in a
fresh process. Every identifier/record/checksum is checked; peak worker RSS must
remain below 256 MiB. Report actual measured timing only after that case passes.

These are isolated tests, not a live-cloud SLA or a browser/provider deployment
certification. 10/50/100 GiB pairs and representative large compressed projects
still require measured production acceptance before such capacity is advertised.
