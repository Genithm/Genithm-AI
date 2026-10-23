# V54 — real GWAS in Genithm (local exploratory association)

Genithm previously treated GWAS as an unsupported research task because the LLM had a rigid list of eight server-side actions. V54 adds an actual, **bounded, browser-local GWAS engine** and an authenticated `/dashboard/gwas` user interface. GWAS requests typed in chat now get routed to that tool instead of an inaccurate refusal. Other scientific topics are discussed and planned honestly, even when a corresponding engine has not yet been implemented.

This is an **initial GWAS execution capability**, **not** a validated biobank-scale distributed genome-wide pipeline. Claims must be scoped to tested formats, methods and limits. The AI does not execute GWAS autonomously or invent results. The researcher supplies both inputs and starts a local run.

## Data formats

**Genotypes:** uncompressed UTF-8 multi-sample VCF v4.x with a `##fileformat=VCFv4.x` declaration, `#CHROM POS ID REF ALT QUAL FILTER INFO FORMAT sample1...`, and a biallelic diploid GT genotype per sample (`0/0`, `0/1`, `1/1`, phased equivalents or missing GT `./.`). GT may occur at any FORMAT index. Multiallelic rows are excluded; non-diploid/haploid genotypes are rejected to prevent silently wrong dosage. **OR** use a variant-major CSV/TSV with first three fields `CHR POS SNP` and one numeric 0..2 allele-dosage column per sample, names matching the phenotype table. Missing dosages: `NA`, `.`, `-9`, empty.

**Phenotypes:** CSV/TSV with `sample_id`, `phenotype`, then up to eight numeric covariate columns (e.g. `PC1`, `PC2`, `age`, `sex`) included in adjustment; one unique sample per row, matched by exact ID. For binary mode, the phenotype is **0 control / 1 case** (not PLINK's 1/2 coding). Missing phenotypes/covariates are excluded. An unadjusted analysis requires explicit researcher acknowledgement.

The browser does not upload or store input files. No raw genotype/phenotype values are sent to a language model, API server or Supabase. Downloads include full tested-variant summary statistics, scientific method, corrected P-values, and SHA-256 of both input files (no participant IDs). The local result is not an authoritative server-verified scientific job and is not saved to research history.

## Computation and integrity

- Quantitative: biallelic additive genotype effect `y = intercept + covariates + beta*dosage + error`, OLS using covariate-orthogonalized genotype/phenotype. Two-sided Student-t P with residual degrees of freedom `n - 2 - k`. Each variant uses the *exact subjects with complete genotype/phenotype/covariates*, not genotypes imputed to mean.
- Binary: the per-variant **efficient logistic score test** (1 df), fitting the covariate-only logistic null to complete subjects and removing the weighted covariate projection from the genotype score. This is **not** a Firth regression and does not report fitted odds ratios. Nonconverged models are excluded.
- QC: genotype missingness, minimum minor allele frequency and minor allele count 5, >=20 complete samples, >=8 cases and >=8 controls for binary traits; no fabricated estimates for rank-deficient or non-converged tests.
- Multiplicity: Bonferroni P and monotone Benjamini-Hochberg q-values across all **tested** variants. Manhattan and Q–Q plots are derived only from computed P-values. A conventional 5e-8 line is a visual reference, **not** an automatic study-specific threshold or a validation of association.
- Source file SHA-256, per-reason variant exclusions, analyzer version and methods in export. No code execution or external network access is part of the browser worker.

**Limits:** genotype ≤64 MiB, phenotype ≤2 MiB, ≤2,000 genotype sample columns, ≤50,000 variant rows, ≤12 million sample-variant cells. Limit checks fail closed; they do not truncate data. The hard limits reflect bounded browser RAM/CPU and are not a proxy for clinical-scale throughput.

**Scientific limitations:** No high-scale PLINK2 pgen/bed ingestion, LD pruning, kinship removal, mixed models, HWE checks, imputation, sample relatedness QC, batch effects modeling, sex chromosome ploidy models, population PCA calculation, rare-variant aggregation, trans-ancestry meta-analysis or clinical result certification. If a user has those data/needs, report the requirement rather than outputting misleading associations. PLINK2 `--glm` is the appropriate production starting point for covariate-aware standard GWAS; complex related or unbalanced cohorts commonly require REGENIE/SAIGE or equivalent model selection.

References: [PLINK 2.0 association reference](https://www.cog-genomics.org/plink/2.0/assoc), [EBI GWAS summary-statistics specifications](https://www.ebi.ac.uk/gwas/docs/methods/summary-statistics/).

## Tests

- Node regression tests verify a planted quantitative signal with covariates; same regression results from dosage TSV and actual diploid VCF GT; binary logistic score test; stringent validation; missing/rare SNP exclusions; multiple-testing correction and formula-safe TSV export.
- A separate synthetic NumPy/SciPy cross-check independently validates quantitative beta, standard error and two-sided t-test P, and binary efficient logistic score test statistic and chi-square survival P.
- Model/gateway cannot execute unapproved server-side GWAS: database-oriented tool enum remains unchanged, Python capability registry marks GWAS as a **local** executable module with no server job action type.
- Dedicated GitHub Action exercises the local code on all PRs and main. Existing full CI performs web typechecking/build, scientific workers, security audits and browser regressions.

## Research request behavior

Typing `Run GWAS on my study` in chat returns truthful instructions and direct `/dashboard/gwas` route, without consuming Gemini/Groq tokens for an unavailable server-side action. Educational questions about GWAS still go to Gemini/Groq. The input files are selected and explicitly analyzed in the local workspace; a chat turn does not silently trigger biological compute or file movement.

**Planned scale-up:** add separately governed PLINK2/REGENIE/SAIGE workers with private genotype object storage, project authorization, bounded compute queues, tool/model/version provenance, scientific QA, and explicit researcher approval. `available` should be granted only after a real tested engine is connected, not merely by removing prompt restrictions.
