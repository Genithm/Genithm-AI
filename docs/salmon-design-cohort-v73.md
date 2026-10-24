# V73 — Exact experimental-design reconciliation and descriptive gene-level QC

## What is computed

From the real V72 gene-level sample QC output, the researcher can optionally
upload a **separate** plain UTF-8 `sample,condition` CSV of study labels. Each
observed Salmon sample ID must occur **exactly once** in this local design
file. The algorithm groups the already-measured log2(TPM+1) Pearson
correlations by pairs of conditions and computes a median for every
within-group and between-group pair category, retaining counts of undefined
zero-variance correlations. Biological/technical replicate counts remain
separate; the UI warns for fewer than three biological samples in a group.

These are descriptive summaries of **existing measured abundance estimates**.
They are NOT DESeq2/edgeR, inferred experimental labels, genome-reference
checks, p-values, FDR, sample classification, differential expression, or
evidence that condition labels are biologically correct.

## Input and validation

- 16 KiB maximum design CSV; exact header `sample,condition`, plain comma
  separators, no embedded commas, multiline quoting or control characters
- 2–24 uniquely named biological samples, all matching the sample IDs already
  validated by V70/V71/V72 and retaining the original quantification order
- Two to eight declared conditions; a two-group and at least three-samples-per-
  group check is a **descriptive prerequisite indicator**, not permission to
  infer differential expression without an appropriate gene count matrix
- Strict comparison of every pairwise correlation source ID, checked expected
  number of unique pairs, distinct IDs, bounded Pearson r and null handling
- No sample identifiers, GTF annotations, group labels or quantification data
  are sent to an API, AI provider or private compute job by this workflow

## Outputs and provenance

- Matched `sample<TAB>condition` table, in measured quantification order
- Per-group-pair type, defined/undefined correlation counts and measured median
- Expanded provenance JSON includes local SHA-256 of the supplied design CSV,
  the original Salmon `quant.sf` files and mapping/GTF input
- A signed-in Genithm page shows descriptions and warnings, not clinical or
  causally interpreted conclusions

This release is built atop the V71–V72 code and requires its scientific tests to
pass. Production full FASTQ-to-counts pipelines, reference-aware tximport
length offsets, and DESeq2/edgeR remain on the unfinished P1 checklist.
