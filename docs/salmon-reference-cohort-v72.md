# Genithm V71–V72: GTF-backed Salmon gene summaries and cohort QC

## What the combined feature does

The signed-in Genithm **RNA-seq preparation** page can ingest **already generated**
Salmon `quant.sf` results from up to 24 samples. It validates the five mandatory
Salmon fields and exact transcript identity/length sets, then sums quantified
transcript-level TPM and fractional estimated-fragment abundances by gene.

Users may provide either:

1. `transcript_id<TAB>gene_id` TSV, with exactly one unique mapping per
   quantified transcript; or
2. A researcher-supplied standard **GTF gene annotation** with 9 tab-delimited
   fields and quoted `gene_id`/`transcript_id` attributes. Genithm derives the
   same canonical transcript-to-gene TSV locally from transcript/exon/CDS rows,
   rejects ambiguous transcript assignments, and checks one-based coordinates,
   phase/strand and attribute syntax. It recognizes common **unquoted optional
   numeric metadata** (for example `exon_number 1`) but does not interpret gene
   names, biotypes, gene ontology or genomic function.

No FASTQ, genotype, contig sequence, transcriptome reference or annotation
file is sent to Supabase or an AI provider by this browser-local module.

## Real outputs

- Gene TPM matrix and **fractional gene estimated fragments** via summed
  transcript abundances, with exact transcript-ID matching and per-sample
  abundance conservation.
- Number of mapped transcripts per gene, unmatched extra reference entries,
  detected genes (TPM >= 1) and genes with TPM > 0 per sample.
- **Pearson sample-pair correlation on log2(gene TPM + 1)** across all mapped
  genes, with `NA` for zero-variance groups. These are descriptive comparisons
  only. With fewer than 20 genes the report explicitly cautions about extreme
  instability; small coefficients are not proof of sample mix-ups.
- Downloadable gene TPM, estimated fragments, mapping coverage, sample QC,
  sample correlations and optional GTF-derived tx2gene TSV.
- Source quant.sf and source GTF/TSV SHA-256 hashes computed locally, a derived
  mapping SHA-256, source counts, warnings and explicit unverified science flags.

## Mathematical definitions

For transcript set T(g) assigned to gene g, per sample s:

- gene_TPM(g,s) = SUM(t in T(g)) transcript_TPM(t,s)
- gene_estimated_fragments(g,s) = SUM(t in T(g)) Salmon_NumReads(t,s)
- detected_genes(s) = count of genes where gene_TPM(g,s) >= 1
- sample_correlation(s1,s2) = Pearson across mapped genes of
  log2(gene_TPM(g,s1)+1) and log2(gene_TPM(g,s2)+1).

Gene-level abundance sums are checked against independent V70 transcript
summaries. Sample order, matrix gene identity, all finite nonnegative values and
paired sample labels are checked before reporting. This is **not an estimate
of regulatory causation, a quality pass/fail decision or differential expression**.

## Scientific limitations (important)

- GTF parsing validates structure, **not** annotation correctness, genome
  release, assembly, transcriptome index or version compatibility. Salmon
  transcript IDs and GTF IDs must already match exactly, including version
  suffixes. Even exact IDs do not prove matching reference indexes.
- Salmon `NumReads` represents estimated fragment abundance and may be
  fractional. These gene sums are **not raw integer gene counts**.
- The software does not calculate sample-specific effective gene lengths,
  length-scaled counts, offsets or tximport's downstream differential-expression
  object. Do not feed uncorrected estimated fragments directly into DESeq2 or
  edgeR as though a proper tximport pipeline had run. Bioconductor recommends
  accounting for transcript-length effects with offsets or counts-from-abundance
  methods; assay-specific exceptions, including some 3' methods, need review.
- No normalized DESeq2/edgeR model, p-value, FDR, transcript switching,
  differential transcript usage, gene pathway inference, clinical interpretation
  or raw FASTQ quantification is performed.
- SHA-256 metadata checks are local integrity fingerprints, not a
  user-authenticated digital signature or evidence of biological correctness.

## Resource and security bounds

Input guardrails reuse V70 limits (24 samples, 24 MiB each quant.sf, 96 MiB
combined, 1 million transcript/sample matrix cells). V71 validates at most
150,000 transcript-to-gene rows and 8 MiB for the mapping. V72 GTF input is
limited to 32 MiB of UTF-8, 400,000 feature rows, 150,000 unique transcripts,
8,192 characters per feature row, and 8 MiB derived TSV. It accepts no URLs,
process execution, database writes or raw sequencing data. Malformed or
conflicting records fail closed. It does not silently strip identifier
versions, interpolate missing transcripts or invent abundance values.

## Reproduction and release gates

Run these tests with Node 22+ from the repository root:

```sh
node --experimental-strip-types --test \
  apps/web/tests/salmon-gene-summary-v71.test.mjs \
  apps/web/tests/gtf-transcript-mapping-v72.test.mjs \
  apps/web/tests/salmon-gene-cohort-qc-v72.test.mjs
```

Then run existing V69 and V70 regressions plus Next.js TypeScript/production
build, privacy checks and the repository's full GitHub Actions workflows.

The **first future executable pipeline milestone** still requires binding
actual private FASTQ objects to source hashes, verifying a reference transcriptome,
launching approved pinned nf-core/rnaseq and Salmon/STAR under explicit resource
budgets, validating real `quant.sf` artifacts, and a separate tximport+DESeq2/
edgeR stage on appropriate biological replicate designs. The V71–V72 importer
alone is **not a complete bulk RNA-seq solution**.

## Sources

- [Salmon quant.sf file definition](https://salmon.readthedocs.io/en/latest/file_formats.html)
- [Bioconductor tximport guidance](https://bioconductor.org/packages/release/bioc/vignettes/tximport/inst/doc/tximport.html)
- [UCSC GTF file-format conventions](https://genome.ucsc.edu/FAQ/FAQformat.html)
