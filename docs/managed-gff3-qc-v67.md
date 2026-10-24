# Genithm V67 — genuine whole-file GFF3 annotation QC

## Researcher workflow

Use the existing Genithm Data → Large files or universal file library to upload a **strict `.gff3` or `.gff3.gz`**, with optional `.gff3.bgz`/ `.gff3.bgzf` file suffix. Choose **automatic inspection**, not preserve-bytes mode. The existing worker downloads private S3 bytes, calculates whole-object SHA-256, validates each streamed annotation feature and writes the sealed summary to the original owner- and project-scoped file record. The Data workspace displays results and offers the existing authenticated file report and TSV download. The researcher can then select the READY file in Genithm AI chat and ask for interpretation of **verified aggregate feature QC**; the chat server verifies its source/report hashes against the immutable, authenticated research-file snapshot.

## Actual scientific computation

- Strict GFF3 v3 declaration, nine tab-separated columns, signed finite optional score, positive one-based inclusive start/end, strand, and dot/0/1/2 phase.
- Counts for gene, transcript-like, exon, CDS, UTR and other feature *rows*, plus each strand category, CDS phase information and observed contig count.
- One-based inclusive feature lengths: minimum, maximum, mean, and **sum of row spans**. Nested or repeated feature rows are counted independently; this is **not** a union of genomic bases, genome coverage, gene prediction or expression level.
- Optional embedded `##FASTA` is drained and included in original-object checksum and decompressed-byte budget, but its sequence alphabet and biological validity are **not validated**. Its header text is never exported.
- Attributes are structurally framed for safe text handling, but `Parent`, `ID`, `Name`, ontology references and biological relationships are not interpreted. Seqids, attributes, raw feature rows and nucleotide sequence are never included in JSON, TSV or model prompts.

Limits: each streaming input line at most 8 MiB, at most 100,000 distinct contig names in the temporary scanner set, bounded max expanded bytes enforced by the existing private worker configuration, bounded worker wall time/lease, and integer counts within JavaScript's safe range. Memory scales with the number of unique contig names, not total rows. Unknown encodings or invalid records fail closed. This scanner is for GFF3, **not GTF or GFF2 or generic `.gff`**. The S3 upload policy ceiling is not a validated GFF3 throughput benchmark.

## Backward compatibility and privacy

- V67 uses file-format registry `genithm-file-registry/3`; older `/1` and `/2` reports are interpreted under their recorded historical name-hint rules. Previously uploaded GFF3 byte-only reports do **not** silently gain a scientific certification.
- VCF scientific reports from registry `/2` remain accepted, while new VCF reports use `/3`. Existing V65 VCF chat interpretation and V66 deterministic VCF comparisons are preserved.
- Uses the existing checked schema, API, worker lease, private S3 credentials, Supabase RLS/authorization and verified download endpoints. **No database migration, secret, public bucket permission or new machine is added.**
- Client-side previews or files that are not READY never become server-certified results. AI sees only a fixed allowlist of numeric feature totals from verified GFF3 reports.
- `report_sha256` proves report integrity relative to the stored digest, not a signed attestation against malicious privileged writers.

## Verification

Run `pytest -q apps/api/tests/test_gff3_large_data_v67.py` with `PYTHONPATH=apps/api`, and `node --experimental-strip-types --test apps/web/tests/verified-gff3-chat-v67.test.mjs`. The dedicated workflow also executes prior V64/V47/V65/V48 regressions. The managed large-data acceptance workflow repeats the real PostgreSQL/S3/FastAPI authorization, tamper, input rejection, and historical 5-GiB source tests.

## Operator rollout

The large-file worker and paired worker require independent process deployment, private S3-compatible bucket credentials and quotas as described by `deploy/large-data/README.md`. Merging code **does not** activate missing worker heartbeats or verify hosted production performance. Scientific content should not be described as processed until the uploaded object is READY with the new integrity-checked summary.
