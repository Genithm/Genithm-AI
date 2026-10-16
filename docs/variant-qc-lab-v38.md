# Genithm Variant QC Lab (V38)

## What this adds

An authenticated bioinformatics module at `/dashboard/variant-qc` that computes **real exploratory variant quality-control metrics** from a locally selected, uncompressed VCF v4.x file. This is a complementary VCF inspection tool; it is **not** read QC, alignment, variant calling, population-frequency annotation, pathogenicity classification, or clinical interpretation.

No raw VCF bytes, variant positions, sample names or genotypes are sent to the Genithm server by this feature. The file is parsed inside the browser. The user may optionally persist a small **aggregate-only** summary into a project they can access.

### Supported data

- VCF v4.x declaration, standard eight mandatory tab-separated columns, optional `FORMAT` and sample columns. Header column counts are validated.
- Up to **8 MiB** (uncompressed UTF-8), **50,000 records**, **2,000 distinct contigs**, **100 sample columns** and 80 variant-record preview rows.
- Simple DNA bases (`A/C/G/T/N`) and common symbolic alternate alleles: `<DEL>`, `<DUP>`, `<INS>`, `<INV>`, `<CNV>`, `<NON_REF>`, and `*`.
- Structural breakend notation, VCF v3, compressed `.vcf.gz` and arbitrary malformed ALT syntax fail closed. The algorithm does not interpret sample-format fields.

### Calculations

| Metric | Definition |
|---|---|
| Record count | Number of non-header variant records |
| Variant category | Exclusive single-record group: SNV, MNV, insertion, deletion, complex/symbolic, or multiallelic |
| Ti/Tv | Number of canonical transitions `A↔G`, `C↔T` divided by canonical transversions; **only unambiguous, biallelic, nonidentical SNVs** are included. Undefined if denominator is zero |
| FILTER | PASS, missing `.`, or failing a named filter. Missing is not assumed PASS |
| QUAL bands | 0–<10, 10–<20, 20–<30, 30–<40, 40–<60, 60–<100, and 100+. Missing QUAL is counted separately |
| Contigs | Record counts by CHROM, with the 12 most represented contigs displayed. This is **not read depth or per-base coverage** |
| Sample columns | Number of sample fields declared by header. No genotypes or sample names are analyzed, saved, or exported |

These metrics are descriptive only. They do not establish that a variant is biologically true, causal, disease-associated, pathogenic, or clinically actionable. VCFs can carry private genetic information; researchers should follow their institutional handling requirements even when using local processing.

### Privacy and persistence

1. The browser parses the selected file and computes its SHA-256 fingerprint via Web Crypto.
2. The browser displays actual derived QC summaries and up to 80 in-memory preview records.
3. TSV export includes QC counts, the locally computed fingerprint, algorithm version and explicit scientific caveats. It does not include genotypes or raw variant rows.
4. If the researcher chooses **Save aggregate to Supabase**, the authenticated server action accepts a bounded, validated summary, SHA-256 string, project ID and title only.
5. The database derives the true organization from the chosen accessible project, enables row-level security and allows select, insert or delete only for the record owner. Anonymous access is revoked.
6. The persisted source fingerprint is marked **`client_computed_unverified`**. The server does **not** independently verify the source file bytes because it intentionally never receives the raw VCF. A fingerprint is not proof that the uploaded biological evidence was correct.
7. The saved snapshot can be re-opened or exported through an authenticated, private, no-store route and can be deleted without affecting existing scientific jobs.

### Developer verification

- `node --experimental-strip-types --test apps/web/tests/variant-qc-lab-v38.test.mjs`
- `npm --prefix apps/web run build`
- GitHub CI, UI shell, Cloudflare web contract and Supabase local migration tests.

**Do not change the privacy model by adding raw VCF or sample genotype fields to the database schema without a separate security, consent and data-governance review.**
