# Genithm V64: complete VCF site quality control for managed large files

## Researcher workflow

On **Data > Large research files**, select a project, upload a `.vcf`, `.vcf.gz`, `.g.vcf`, or `.g.vcf.gz` file in **Inspect supported formats** mode (the default), and complete the existing resumable transfer. An authorized independent worker then checks the **entire stored object** against its expected byte size and SHA-256 digest and scans every decoded VCF site record. After verification, the file library shows **Complete VCF site QC** with a downloadable, authenticated JSON evidence envelope and a tab-delimited VCF QC table.

Choose **Preserve bytes only** to store even malformed/unsupported files without scientific parsing. BCF is still stored with whole-byte integrity only, not decoded. Never rename BCF or compressed binary files to VCF to force parsing.

## Scientific method and boundaries

- A versioned file-type registry selects a strict, bounded VCF 4.x text parser for valid plain/gzip VCF input. Gzip concatenated members, CRC/trailer errors, source truncation, expanded-byte budgets and cancellation use the existing private verification worker.
- The parser validates the first `##fileformat=VCFv4.0..4.5` metadata line, mandatory 8 tab-delimited fields, optional FORMAT/sample columns, valid reference alleles, literals/symbolic alternate alleles, finite QUAL scores and FILTER syntax. It permits LF and CRLF and caps a decoded line at **16 MiB**, individual REF/ALT alleles at **1 MiB**, unique contigs at **100,000** and samples at **100,000**. The overall decompression limit, worker deadlines, source-size limits, project quotas and lease fencing are unchanged.
- Output metrics are **complete, unsampled site records**: SNV, MNV, indel, complex, symbolic and reference-only site classes; multiallelic site count; canonical SNV alternate allele transitions/transversions; PASS, failed and unfiltered sites; present/unknown QUAL and mean available QUAL; numeric count of contigs and sample columns. Site classes are mutually exclusive. Ti/Tv is an **allele-level** count for canonical A/C/G/T one-base alternatives, not site-based across all records.
- This does **not** decode GT/FORMAT or INFO semantics, estimate allele frequency, assess genotype quality, guarantee coordinate sort order, compare with a reference genome, call variants, predict pathogenicity, or analyze clinical effects. Sample names, contig identifiers, read names, genomic coordinates, variant IDs, genotype strings and input alleles are **not** exported.
- The new metrics live inside the existing canonical, checksummed `genithm-large-data-result/1` JSON envelope using the already permitted `metrics` field. The privileged SQL release contract is **unchanged**, and no new RLS policy, bucket or migration is introduced. The file registry now identifies itself as `genithm-file-registry/2`; old `genithm-file-registry/1` reports—including historically byte-only `.vcf` uploads—remain valid and accessible. Existing FASTQ quality reports and FASTA reports retain their schemas.
- The authenticated `/api/v1/large-data/uploads/{id}/quality-report?format=tsv` endpoint exports fixed metric labels and numeric values without spreadsheet formula injection. JSON and TSV include source SHA-256 and report digest, and have `no-store` and `nosniff` headers. Unauthorized users cannot fetch other projects' results.

## Production readiness and limitations

This feature extends the **already implemented but separately activated managed large-file service**. It needs the existing large-file bucket, project allowance, running server and file-verification worker. Code merge does not enable storage, create a paid bucket, configure secrets, or prove an internet-hosted deployment. The configured 100 GiB transfer ceiling is a policy upper bound, **not** a VCF scanner performance certification at that size. The worker is designed to operate with bounded memory; V64 evidence includes independent scanner fixtures, gzip corruption/limit cases, live isolated PostgreSQL+S3/API integration and the existing large-data acceptance suite. Individual VCF analyses can still take significant CPU and I/O time and an interrupted scientific scan restarts from the beginning.

Reference for VCF column definitions and format semantics: [GA4GH / samtools VCF 4.3 specification](https://github.com/samtools/hts-specs/blob/master/VCFv4.3.tex).

## Reproduction

```bash
PYTHONPATH=apps/api pytest -q apps/api/tests/test_vcf_large_data_v64.py
PYTHONPATH=apps/api pytest -q tests/large_data/test_vcf_integration_v64.py
node --experimental-strip-types --test apps/web/tests/managed-vcf-v64.test.mjs
```

The integration test requires the existing isolated PostgreSQL/S3/auth fixture from `tests/large_data/conftest.py`. No biological patient data or external credentials are used by the tests.