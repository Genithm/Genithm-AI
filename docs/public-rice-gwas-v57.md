# Genithm V57: automatically execute GWAS on real published rice data from AI chat

## Reproducing the user's failed research request

An authenticated researcher can write: **"perform GWAS on rice, you itself pick any real data and give result files here"**. V54-V56 responded only with a fixed instruction to upload unrelated data; subsequent messages lost the requested study and reverted to NCBI sequence tools. That is wrong for a general bioinformatics assistant.

V57 runs a real **published Oryza sativa Plant height GWAS** directly from chat when a user explicitly asks Genithm to select public rice research data, including short follow-up messages in the same thread. Public source selection is deterministic, not inferred from fabricated model citations. It does not choose a private person's sequencing data.

## Source evidence

The Rice Diversity Panel genotyped 413 cultivars from 82 countries. This reproducibility release reads the original workshop-hosted PLINK PED (genotypes), MAP (SNP IDs, chromosomes and positions), `sativas413.pheno` (measured Plant height, NSFTVID identifiers) and `sativas413.csv` (population-structure PCs). Sources:

- Zhao et al. 2011, *Nature Communications*, DOI https://doi.org/10.1038/ncomms1467
- Published dataset: https://www.ricediversity.org/ (Rice Diversity Panel 44K)
- Auditable source files: https://github.com/rladiestunis/R4Bioinfo-series-workshop-Introduction-to-GWAS/tree/d83cc64f993f8a86485d30f715381b3c613e3d69
- Trusted raw endpoint only: https://raw.githubusercontent.com/rladiestunis/R4Bioinfo-series-workshop-Introduction-to-GWAS/d83cc64f993f8a86485d30f715381b3c613e3d69/

All four Git blob object digests are pinned in `scripts/public_rice_gwas.mjs`; every downloaded file is verified before parsing. SHA-256 hashes are recorded in the report. Fail closed on a changed source or incompatible schema. Do not redistribute the original raw genotypes in generated result bundles.

## Real computation and artifacts

- Direct genotype and phenotype accession join (not assumed by row order), published quantitative phenotype, and real PC1/PC2/PC3 covariates.
- All 36,901 source SNP positions are considered. Original biallelic PED genotype allele pairs are converted to diploid 0/1/2 dosages with missing genotype values preserved. Multi-allelic variants are rejected, not silently recoded. No genotype values are simulated.
- Per-SNP covariate-adjusted OLS with two-sided Student-t tests; complete-case genotype removal; missingness <=10%, minor allele frequency >=5%, minor allele count >=5. Existing validated V54 numerical GWAS implementation is reused for 3,000-SNP chunks to bound peak memory. **Bonferroni and BH q-values are recomputed across all tested SNPs**, never separately per chunk.
- Result files: full `association.tsv`; `manhattan.svg`; `qq.svg`; source checksums/methods `provenance.json`; `summary.json`; human `README.md`; all six in `rice-gwas-results.zip`. These files are created by code, not by Gemini/Groq text.
- Users get download controls directly under the corresponding assistant reply in their Genithm thread. All file GETs check Supabase-authenticated identity and file SHA-256, and expire after 48 hours. Results are private temporary files on this Codespace; they are not durable RLS-audited database job objects.
- Users receive progress messages about real data download / SNP testing. Only one public dataset job can run at a time in a Codespace, with a seven-minute worker deadline and browser cancellation. All child process environment keys are removed.

## Supported deployment boundary

This first automated public-source executor runs **only in a private GitHub Codespace in development mode** (`GENITHM_CODESPACES_PREVIEW=1`, with Codespace env). Do not claim hosted Cloudflare or a different environment can safely run POSIX subprocesses. The existing GWAS Lab for user-supplied local study files remains separate and unchanged. No new Supabase table/function, no private user-data fetch, and no new API credentials. Existing signed-in chat RPCs persist the request and result message.

## Public-data scientific validity and genomic inflation

All analyzed SNP P values are used to compute the **genomic inflation factor**
lambda_GC = median(chi-square(1) equivalent statistics) / 0.4549364231.
The independently verified original rice panel run yielded **lambda_GC ≈ 5.47**,
indicating very substantial inflation. The model adjusts for three published
population principal components, but strong relatedness/population structure,
linkage, batch effects or true widespread polygenicity can inflate the
distribution. Thousands of SNPs below a naive Bonferroni threshold are **not**
established independent causal or breeding-relevant loci. The analysis reports
lambda_GC and a prominent caveat in the chat, machine JSON, README, and
source provenance. Kinship-aware GWAS with population diagnostics and
independent replication is needed for scientifically rigorous associations.

Subsequent identical requests can reuse public result outputs cached in the
Codespace only when **every artifact checksum**, source commit, method version,
and computation parameters match. Each researcher has separately authenticated,
expiring access to their own copy. No private genotype data enters this cache.

## Scientific caution

This is a reproducible exploratory public-data **association** study, not a causal or published rediscovery claim. Covariates include published population PCs, but a kinship-aware linear mixed model, additional sample QC, LD and independent validation are necessary before making rigorous locus discoveries. No medical or plant-breeding recommendation follows automatically. The demonstrated trait is **Plant height**; don't report analyses of other rice traits as completed. All downloaded and interpreted sources are pinned; source terms must be respected.

## Verification

- `node --experimental-strip-types --test scripts/tests/test_public_rice_gwas.mjs` — synthetic PED/phenotype joining, planted association, zipped result integrity, delegation/follow-up routing and fail-closed corrupt input.
- GitHub Action `Public rice GWAS real dataset and chat V57` fetches **actual 413 rice accessions x 36,901 SNPs** and runs the complete algorithm, verifies every output and uploads the real research result bundle as a 14-day GitHub Actions artifact.
- Main web production build, TypeScript, Supabase auth entry, Cloudflare output contract, and security policy must pass on the same commit. A build/test success cannot establish that a researcher's private Codespace is running a revised commit until they update and restart it.
