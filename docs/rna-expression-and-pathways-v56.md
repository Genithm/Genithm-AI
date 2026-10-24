# V56 — executable RNA expression and pathway enrichment (local)

**Two new working analysis engines, distinct scientific domains:**

1. `/dashboard/expression`: exploratory bulk gene-count matrix comparison, with actual normalization, gene QC, two-sample tests, sample PCA, volcano chart, Benjamini–Hochberg multiple testing, downloadable all-gene TSV and selected/background gene-ID files.
2. `/dashboard/pathways`: one-sided exact hypergeometric gene-set over-representation, with researcher-provided selected IDs, tested-gene universe and GMT pathways. Tests all eligible sets *including those with zero overlap* for BH FDR, shows overlap/enrichment ratios, computes a plot and exports all tested sets.

The AI routes explicit **execution** requests toward the appropriate input-driven lab, without sending local file bytes to Gemini/Groq, silently running code from files or fabricating completed jobs. Conceptual questions continue through Gemini/Groq.

## Expression inputs and methods

Uncompressed, unquoted plain UTF-8 TSV/CSV `gene_id, sampleA, sampleB, ...` with **raw nonnegative integer gene counts** (not TPM/FPKM/CPM, not raw FASTQ, not a differential expression result). Design TSV/CSV must contain **exactly** `sample_id, condition`, with exact matching unique samples; exactly two groups and >=3 independent biological samples in each. Other columns such as covariates/batches are explicitly **rejected**, rather than ignored. Reference group defaults to lexical first, or can be chosen by the researcher. The sign of log2FC always means comparison/reference.

1. Validate full input, unique rows and sample IDs; reject negative, fractional and missing counts. Count each sample's original library size.
2. DESeq-style median-ratio **normalization only**, from genes with nonzero counts in every sample; require >=10 such genes; factors standardized to geometric mean 1. Convert adjusted counts to fixed reference-library normalized CPM.
3. Low-expression filter: CPM >= configured minimum (default 1) in at least as many samples as the smaller group. Drop untestable zero-variance genes without manufacturing P-values.
4. For each tested gene: two-sided **Welch t test on `log2(normalized_CPM + 1)`** across independent biological samples, Welch–Satterthwaite degrees of freedom, actual Student t survival P. Report also log2 of the comparison/reference arithmetic mean CPM+1 ratio. BH FDR across all tested genes.
5. PCA on the top 200 variable gene logCPM profiles, computed from a sample cross-product matrix and two leading eigenvectors. This is a QC visualization, not adjustment for population, batch or confounding.
6. Full tested gene statistics TSV, FDR + |log2FC| selected gene IDs and tested background IDs (directly usable by the Pathway Lab); input SHA-256 and method/version in separate provenance JSON.

**Research boundary:** This is a mathematically testable *exploratory* method, not rigorous RNA-seq negative-binomial inference. It does **not** substitute for DESeq2, edgeR, limma-voom, or covariate-aware statistical modeling; no dispersion shrinkage, outlier Cook's distance, batch/paired/repeated design, random effects, splicing, raw FASTQ quantification, or other population-scale algorithms. Count-depth and batch confounding may cause misleading results. Differential expression requires experimental replicates. Appropriate production RNA-seq DE routinely uses negative-binomial GLMs with dispersion and contrast designs (see [Bioconductor DESeq2](https://bioconductor.org/packages/release/bioc/vignettes/DESeq2/inst/doc/DESeq2.html)).

**Bounds:** <=32 MiB uncompressed count text, <=512 KiB design, 20–50,000 genes, 6–128 samples, <=4M gene-by-sample cells, >=3 per group. Fail closed (no silently truncated rows). A dedicated Web Worker allows cancellation without blocking interactive chat.

## Pathway inputs and methods

Selected genes and background genes: plain one-ID-per-line UTF-8 files, optional `gene_id` header. **Measured universe is mandatory**; selected IDs must be a subset. Both lists <=1 MiB, background 20–50,000 distinct IDs, selected <=5,000 distinct IDs. GMT file <=8 MiB, <=10,000 gene sets; each line `<set_id><TAB><description><TAB><gene1><TAB>...`; gene IDs must match the input ID namespace and case. Duplicate IDs/sets are rejected. Gene sets are intersected with the measured universe. Sets with fewer than 3 or more than 2,000 effective genes (or covering the entire background) are excluded with counts; eligible zero-hit sets are included in the multiple-testing denominator.

For each eligible set, compute `P(X >= observed)` with the exact hypergeometric distribution: population `N` measured genes, set size `K` after intersection, draw size `n` selected genes, observed overlap `k`. Stable log-factorial recurrence with one cache across all pathways avoids numerical over/underflow and performance blow-ups. The expected overlap is `n*K/N`, enrichment ratio is observed/expected; apply BH FDR across **every eligible GMT set**. No Internet annotation download or knowledge-base endorsement is implied. The gene IDs and GMT contents are user-provided, not verified as official gene ontology terms.

## Privacy / provenance / deployment

Both engines run only in local Web Workers, with no network calls, background storage, database schema migrations, or new API secrets. Source SHA-256 is computed from complete file bytes and can be exported with method/limits. Results are ephemeral in the browser, **not authoritative stored project jobs**, and cannot be used as proof of clinically validated findings. A user deliberately downloads results to store them.

V56 marks `differential_expression` and `pathway_analysis` as **available / local** in the capability registry, with **no executable server action_type**. `rna_seq_quantification` remains planned. Scientific consent, tenant RLS, existing GWAS, V55 file intake and the fixed research workflows are untouched. A later server-grade pipeline can integrate DESeq2/edgeR with reproducible containers, validated object storage and explicit researcher approval instead of describing this exploratory lab as enterprise compute.

## Verification

- Node tests: independent SciPy reference values for Student t and hypergeometric upper tails, planted differential-expression effect, sample-ID row order, normalization invariance, reference direction, actual BH correction, privacy and input rejection, exact background, and chat route integration.
- Python capability tests prove these local tools are not added to the server-side allowlist.
- Existing GitHub CI covers web TypeScript, production Next.js build, SSR auth, Cloudflare and scientific backend compatibility; the dedicated V56 workflow executes the new scientific tests.
- Source changes do not restart private Codespaces automatically. `git pull --ff-only` + existing `GENITHM_CODESPACES_MODE=chat bash .devcontainer/start.sh` is required before the user can try the feature.
