# Genithm scientific coverage checklist — V73 (P0–P10)

**Checked against:** GitHub `main` at V70 (commit `34f6552`) and private
Supabase readiness read on **2026-10-24**. V71–V73 development status is tracked
separately from merged code and deployable services. Keep this distinction in
user-facing messages and never mark a whole scientific phase complete because
its metadata reader or QC module exists.

**Key:** `[x]` = the narrowly described code milestone is merged/tested;
`[ ]` = not fully delivered. "Partial" is not a completed end-to-end pipeline.
See [the P0–P10 delivery plan](universal-bioinformatics-delivery-plan-v69.md),
[GitHub issue #264](https://github.com/Genithm/Genithm-AI/issues/264) and
[the in-app checklist](/dashboard/capabilities).

## Completed, narrowly scoped engineering milestones

- [x] V64: streaming VCF site QC and authenticated numeric reports (not variant calling)
- [x] V65: verified VCF aggregate evidence in AI chat (not raw genotype analysis)
- [x] V66: deterministic comparison of 2–4 VCF QC reports (not variant concordance)
- [x] V67: streaming GFF3 feature summary (not annotation interpretation)
- [x] V68: private verifier Compose deployment **configuration** (not an online worker)
- [x] V69: authenticated browser-local bulk RNA-seq metadata/sample-design preflight
- [x] V70: browser-local import of existing Salmon transcript quant.sf abundance
- [ ] V71–V72: gene-level transcript sums, GTF mapping, descriptive sample QC **must pass actual GitHub CI and merge** — [PR #265](https://github.com/Genithm/Genithm-AI/pull/265); locally 21/21 scientific tests passed
- [ ] V73: exact researcher sample-condition reconciliation and within/between-group descriptive correlation summaries, with browser reports and roadmap UI **must pass actual GitHub CI and merge**

## Scientific phase acceptance — NO PHASE CERTIFIED COMPLETE

### P0 — Operational infrastructure: BLOCKED

- [x] Versioned science-worker and private-file-worker code exists
- [x] Optional private-worker deployment recipe is merged
- [ ] Six core scientific workers **online with fresh heartbeats**
- [ ] Private universal and paired large-file worker services **online**
- [ ] Authorized projects with private managed upload capacity enabled
- [ ] Real owner-scoped upload → full scientific analysis → report validated under a deployed runtime with correct source and output hashes
- [ ] Resource limits, cancellation, tenant isolation, network egress and cost approval tested in the live environment

**2026-10-24 database observation:** core worker readiness `not_ready` (all
six stale); 0 online large-file verifiers; 0 online paired verifiers; 0 enabled
large-file projects. This observation can become stale; use
`/dashboard/operations` for current status, not this historical checklist.

### P1 — Bulk RNA-seq: PARTIAL

- [x] V69 validate RNA-seq metadata sheets and biological condition labels
- [x] V70 import measured, preexisting Salmon transcript TPM/NumReads
- [ ] V71–V72 gene-level sums, strict tx2gene/GTF import and sample QC **merge**
- [ ] V73 match sample labels against measured cohort and summarize descriptive within/between correlations **merge**
- [ ] Bind real authorized FASTQ objects, matching immutable reference FASTA/GTF and verified Salmon index
- [ ] Run pinned nf-core/rnaseq or equivalent STAR/Salmon under human-approved, metered compute
- [ ] Produce validated, reference-aware gene expression quantification and tximport-type length offsets
- [ ] Execute correctly specified DESeq2/edgeR statistical inference with biological replication, design contrasts and diagnostics
- [ ] Independent real public FASTQ truth-set benchmark, lineage, owner-scoped artifacts and cancellation tests

**Not available:** universal FASTQ → gene counts → genuine DESeq2/edgeR results.
Summing Salmon NumReads is NOT tximport/tximeta and the exploratory
expression-workbench's Welch tests are NOT DESeq2.

### P2 — DNA-seq/WGS/WES: PARTIAL

- [x] Bounded SAM/BAM alignment QC and VCF site QC implemented
- [ ] Complete FASTQ → read alignment → sorted/indexed alignment → caller → annotated VCF
- [ ] Structural variation/CNV and GIAB-like benchmark verification

### P3 — Single-cell and spatial: NOT STARTED AS COMPLETE WORKFLOWS

- [ ] Real cell/spot calling, scRNA QC, integration, clustering and marker evaluation
- [ ] Spatial molecule/image coordinates and cell-neighborhood modeling

### P4 — Epigenomics: NOT STARTED AS COMPLETE WORKFLOWS

- [ ] Assay-specific ATAC-seq/ChIP-seq/CUT&Tag pipeline and controls
- [ ] DNA methylation calls, validated peaks and differential inference

### P5 — Microbiome and metagenomics: NOT STARTED AS COMPLETE WORKFLOWS

- [ ] Microbial classification with versioned databases and negative controls
- [ ] 16S/shotgun community benchmarking, bins and functional profiling

### P6 — Proteomics/metabolomics: NOT STARTED AS COMPLETE WORKFLOWS

- [ ] LC-MS/MS raw data scientific processing
- [ ] Proper peptide/PSM FDR, protein quantification and benchmarked profiling

### P7 — Protein structures, docking and dynamics: PARTIAL

- [x] Bounded protein sequence properties and limited reference annotation
- [ ] Real structure prediction and geometry validation
- [ ] Docking benchmark and molecular dynamics with honest uncertainty

### P8 — Population/comparative/regulatory genomics: PARTIAL

- [x] Exploratory GWAS and small-sequence analysis modules
- [ ] Kinship/ancestry-aware GWAS, phasing and imputation
- [ ] Genome assembly, synteny, pangenome and validated CRISPR off-target workflows

### P9 — Multiomics governance and clinical boundaries: PARTIAL

- [x] Project-scoped research notes, checksum/provenance records and QC reports
- [ ] Cross-omics reference reconciliation and data-consent governance
- [ ] Independent external clinical-grade validation and regulated signoff; clinical claims disabled until then

### P10 — General AI-driven execution: PARTIAL

- [x] Some approved, limited scientific chat actions and worker queues exist
- [ ] Universally parameterized Nextflow/nf-core tool registry with immutable source/reference hashes
- [ ] Resource-budgeted human approval, queue leases, cancellation and error recovery
- [ ] Real results returned as authenticated, tamper-checked artifacts in the conversation

## Immediate next release gates

1. [ ] PR #265: all scientific regression and full repo GitHub workflows green, then merge V71–V72.
2. [ ] V73: scientific group QC + in-app checklist tests green, then merge and tick its *component* only.
3. [ ] P0: operator activates separate worker services, private S3 and quotas; no unapproved paid compute.
4. [ ] P1: trusted runtime handles reference-bound real FASTQ and pinned Salmon/nf-core pipeline, with honest actual output metrics.
5. [ ] P1: test legitimate transcript-to-gene quantification offsets and DESeq2/edgeR after reliable raw-count and design validation.
6. [ ] P2–P10: each phase's defined real-data benchmark and access-control checks before any checkmark.
