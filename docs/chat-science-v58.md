# Genithm V58 — real scientific execution and files inside BioAI chat

## Why this release exists

The previous chat frequently responded with "go to the GWAS/RNA/pathway Lab and supply files" because it received only browser-local file descriptions, not the original bytes. The model's tool-action list contained only eight server execution types. V57 made exactly one **public rice plant-height GWAS** executable from chat. Neither a broader list of model tools nor an LLM-generated Python suggestion counts as scientific execution.

V58 adds a **deterministic, explicit, science-to-chat execution path** for three existing validated analyzers and an additional trusted, published public example. Normal NCBI retrieval, BLAST, MSA, phylogeny, protein analysis and their existing approval/provenance APIs remain unchanged and available when their scientific backend is running.

## What actually runs

| Chat request | Input material | Real computation | Output files |
|---|---|---|---|
| "Run GWAS on these files" | Uncompressed multisample diploid biallelic VCF v4 or CHR POS SNP dosage table + matched sample_id phenotype CSV/TSV | Real quantitative additive OLS or binary logistic score testing with variant QC, optional numeric covariates, BH and Bonferroni | All association P-values, Manhattan and Q–Q SVGs, JSON summary/provenance, METHODS and ZIP |
| "Compare RNA expression" | Integer raw gene-count table (gene_id x samples) + sample_id,condition design | Median-ratio normalization, sample PCA, exploratory per-gene Welch tests on log2 CPM, BH FDR | Complete expression TSV, significant and tested gene IDs, sample QC and PCA coordinates, volcano/PCA SVG, ZIP |
| "Run pathway enrichment" | Selected genes, explicitly measured gene background, matching GMT gene sets | Exact hypergeometric right-tail ORA, BH FDR over all eligible gene sets | Full pathway TSV, enrichment SVG, JSON and ZIP |
| "Run RNA-seq on publicly available data; you pick" | No attachments, authorized conversation | Fetches and SHA1-verifies the **published Himes et al. 2014 airway RNA-seq read-count matrix**, eight human airway smooth muscle samples (4 treated dexamethasone, 4 controls); runs the same exploratory count-matrix statistics | Same expression outputs and authentic public-file SHA256/source citation |
| "Perform rice GWAS with any real data; give files" | No attachments | Reuses V57 published Rice Diversity Panel plant-height GWAS, 36,901 mapped SNPs, adjusted with published ancestry PCs | Complete V57 association TSV, Q–Q/Manhattan, methods, provenance, ZIP |

**Not implemented:** arbitrary dataset autodiscovery with validated sample metadata for every organism/trait, raw FASTQ to count-matrix quantification, paired/covariate-adjusted DESeq2/edgeR, mixed-model kinship GWAS, single-cell matrix analysis, or all exotic/binary file types. Don't claim they have run.

### Public data provenance

The public airway example applies a **predefined low-count filter of at least 10 raw counts in at least 4 of 8 biological samples** before normalized CPM filtering. Original, retained and tested gene counts are separately reported. No first-N row truncation or fabricated gene values.

- [Himes et al. 2014 airway RNA-seq (PMID 24926665)](https://pubmed.ncbi.nlm.nih.gov/24926665/); [audited workshop source repository](https://github.com/bioconnector/workshops/tree/68ff3e4868b0e5673a1c4399828a3e0adc72f8e4/data). Two exact source blobs are pinned by git SHA1 in `scripts/chat_science_worker.mjs`. The published study is **paired by cell line**; V58's unpaired Welch test does not account for pairing. Interpret as exploratory only, not DESeq2 inference.
- [Zhao et al. 2011, Rice Diversity Panel](https://doi.org/10.1038/ncomms1467); V57 pinning and source hashes described in `docs/public-rice-gwas-v57.md`. V57 reports large genomic inflation (λGC about 5.47); its SNP associations are **not** certified loci.

The public-code executor never substitutes a human dataset when the user requests rice, maize, mouse, single-cell, FASTQ quantification, or another explicitly different scientific design. If no matching fully implemented source is available, chat provides a truthful explanation, never false result links.

## Uploading your own research files in chat

1. Attach the matching two or three **real files** to the same BioAI message and ask the specific scientific analysis. Header/extension matching determines the role of each attachment; ambiguous file groups are refused, not silently rearranged.
2. Explicitly tick **Authorize Genithm to temporarily transfer attached files to the private Codespaces scientific worker**. Without this opt-in, raw files remain browser-local preview material; they are never secretly transmitted to an AI provider.
3. Press Send. The checkbox also acknowledges that GWAS without ancestry covariates is an **unadjusted exploratory** study with substantial confounding risk, not a validated locus discovery. Binary 0/1 phenotypes are detected and tested with the logistic score method; continuous traits receive additive OLS. The client posts a bounded multipart request to authenticated `/api/ai/science-results`. Supabase's own user-scoped project query ensures the researcher can access the selected project. The server writes originals to private 0700 temporary folders, spawns one isolated, non-shell scientific child with **no Gemini, Groq or Supabase secrets**, and immediately deletes original files on completion/failure/cancellation.
4. The scientific worker writes deterministic result tables, charts, methods, and source SHA-256 fingerprints into an owner-scoped private results folder. The server verifies **every** output's SHA-256 and rejects malformed manifests. It then persists an assistant message with a validated result reference into the existing authorized chat thread. It cannot be impersonated with a fabricated run ID, wrong project ID, or a foreign user's files.
5. The conversation displays real result-file download controls. Each GET reauthenticates the user, verifies current project access and rechecks the file SHA-256. Temporary results expire after **48 hours**. Download the archive before it expires; these local files are not a permanent Supabase storage record.

Upload sizes: GWAS genotype 64 MiB and phenotype 2 MiB; RNA raw counts 32 MiB and design 512 KiB; gene sets GMT 8 MiB and selected/universe lists 1 MiB each. The underlying scientific engines have additional sample/gene/SNP bounds, independent of file sizes. One CPU-bound scientific child runs per private Codespace with a **150-second time limit**; the Node web event loop remains responsive. The public RNA result is cached only after every derived file hash, source, and engine version match. **No private files are cached.**

## Technical security contract

- New scientific engines are not added to the existing unrestricted LLM proposal-tool array. Chat routing and exact file roles are deterministic. Any legacy science-job approval/permissions remain intact.
- Public requests use a closed dataset allowlist and immutable git source digests, never arbitrary LLM-produced URLs or code execution. The process cannot inherit API provider or database credentials.
- Forged client-run IDs are checked against the authenticated user, project, age, fixed allowed filenames and artifact hashes **before** the assistant reply is stored.
- Unrecognized, corrupted or incompatible input returns a visible error; no fabricated results or speculative biological interpretation.
- Full research analysis does not run on the Cloudflare-only edge deployment: a private Codespaces execution worker is currently required. The chat can still converse and inspect metadata in those environments.
- Browser-local privacy alternatives remain available at `/dashboard/gwas`, `/dashboard/expression`, `/dashboard/pathways` for researchers unwilling to transmit original data to the server.
- Results are exploratory; raw genotype/phenotype files are never sent to Gemini/Groq. Only the validated completion text (not raw inputs) is saved to the conversation.

## Verification and release gates

- `node --experimental-strip-types --test scripts/tests/test_chat_science_v58.mjs` tests genuine calculation calls, real TSV/plot/ZIP/checksum artifacts, security guards, cross-project result restrictions, upload headers, dataset-delegation persistence and refusal to invent unsupported studies.
- `.github/workflows/chat-science-v58.yml` additionally downloads authentic pinned public airway RNA-seq data, computes the entire study and validates sample counts, actual gene tests, source SHA1/256s and downloaded result integrity; publishes the verified research outputs as a CI artifact.
- Main CI/typecheck, Next production build, Cloudflare output, Codespaces startup, V57 rice GWAS, V56 expression/pathway and V55 file-upload regressions must be reviewed before merge. Full private Codespace trial after `git pull` is still needed; CI cannot authenticate to the user's session or secrets.

## Next scale-out milestone

Unify the verified executor catalog into a versioned backend job queue with durable per-project storage, previewable provenance and audit trails; support authenticated retrieval of existing project-file bytes, approved NCBI GEO/SRA/EBI download resolution, Nextflow/nf-core RNA-seq and DESeq2/edgeR, PLINK2/REGENIE/SAIGE kinship GWAS, multiomics and appropriate GPU services. Each new source+method pair must pass a real-data acceptance test before chat offers it as an executable capability.
