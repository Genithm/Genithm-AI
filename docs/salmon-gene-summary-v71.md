# Genithm V71 -- audited transcript-to-gene summarization

## Scientific task actually added

Build gene-level numerical summary tables from **existing, externally generated**
Salmon `quant.sf` output and a researcher-supplied `transcript_id<TAB>gene_id` TSV.
This is a concrete next step after Genithm V69 (RNA-seq study metadata preflight)
and V70 (local import of transcript-level Salmon output). The new V71 module
is designed for use in the same authenticated Genithm RNA-seq workspace.

The whole operation is **browser local**, from selecting files through preview
and download. It never calls Supabase, an AI provider, a shell executor, an
outside reference database or a private worker. Output files are downloaded
only when the researcher clicks the download control.

## Input requirements

1. A coherent collection of **1--24** actual Salmon `quant.sf` files, with
   24 MiB maximum per sample and 96 MiB total; the existing V70 import must
   finish successfully and produce the validated transcript matrix.
2. An independently prepared mapping TSV containing the header `transcript_id`
   followed by `gene_id` (tab-separated); one row per transcript with exact
   matched identifiers and no ambiguous/duplicate transcript assignment.
3. Mapping file at most 8 MiB / 150,000 entries. Unquantified mapping entries
   are reported but not incorporated into the result. Every transcript
   actually quantified **must** have a mapping.
4. Both matrices must contain the same sample names, the same ordered transcript
   identities, and finite positive/zero observed abundance. Transcript data
   are validated by V70 first. No automatic removal of transcript version
   suffixes or arbitrary ID normalization is performed.

## Measured computation (not statistical inference)

For each gene and sample, the actual reported transcript abundances are summed:

- `gene_TPM[gene,sample] = sum(TPM[t,sample])` for mapped transcripts `t`;
- `gene_estimated_fragments[gene,sample] = sum(NumReads[t,sample])`;
- `mapped_transcripts[gene] = count of input transcript IDs assigned to gene`.

The algorithm preserves *fractional* NumReads and never rounds them to integer
count data. Gene sums must conserve each source sample's validated totals
within bounded numeric rounding tolerance. Output is a genuine TSV matrix,
not an LLM-generated estimate.

Example deterministic **synthetic** result:

```
gene_id  CTRL1   TREAT1
GENE_A   750000  200000
GENE_B   250000  800000
```

The `gene_TPM.tsv`, `gene_ESTIMATED_fragments.tsv`, mapping coverage and local
SHA-256 input evidence provide an auditable research trace. Hashes are
calculated from selected browser **file bytes** but are not authentication,
user authorization, transcriptome/reference validation or biological proof.

## Explicitly not implemented

- No FASTQ read access, alignment, Salmon execution or reference/index build.
- No verification that transcript-to-gene mapping matches the original
  Salmon reference index or that assembly/annotation versions are compatible.
- No tximport/tximeta equivalence or generation of effective gene lengths,
  gene-length offsets, inferential replicates, scaledTPM or lengthScaledTPM.
- No true raw integer gene count matrix, DESeq2/edgeR negative-binomial fit,
  log2 fold change, P value, q value, pathway association or clinical result.
- No service deployment, paid worker process or change to managed storage.

For true differential expression with Salmon output, a future reviewed
`tximport`/`tximeta` pathway must be added and validated independently.
Bioconductor notes that summarized counts can be fractional and average
transcript lengths and counts-from-abundance options materially affect
models: https://bioconductor.org/packages/release/bioc/vignettes/tximport/inst/doc/tximport.html

## Tests and release gate

`node --experimental-strip-types --test apps/web/tests/salmon-gene-summary-v71.test.mjs`

The seven dedicated tests cover actual summation from V70-compatible Salmon
fixtures, stable ID ordering, unmatched/duplicate/unsafe mapping rejection,
extra reference transcript warnings, conservation against sample totals,
zero-expression genes and the absence of external execution calls.
A production PR must also pass existing V70 transcript import, V69 RNA-seq
preflight, V56 count-matrix expression regressions, TypeScript/Next.js build,
Cloudflare compatibility, and the repository's broader CI/security gates.

## Next real execution milestone

Future versioned integration must bind actual managed FASTQ bytes and all
reference FASTA/GTF/index objects to owner/project-authorized SHA-256 digests,
validate versions and run a pinned, non-privileged nf-core/rnaseq workflow
with explicit cost/resource approval. Only measured FASTQ-to-counts output
from a verified execution can justify moving the platform's scientific
capability claim from **imported** to **executed**.
