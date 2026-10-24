# Genithm: full bioinformatics delivery plan (V69)

Goal: evolve Genithm's existing ChatGPT-style bioinformatics AI into a
research platform that plans studies, obtains approval, runs reviewed
scientific engines, and explains independently verified artifacts.

A menu entry, upload format, code merge, or language-model-generated explanation
is NOT proof of actual scientific computation. Each executable stage needs
valid inputs, a pinned reference and tool, per-project authorization,
controlled resources, scientifically meaningful tests and working deployment.

## Starting conditions (October 24, 2026)

Existing code includes FASTA/FASTQ/VCF/BAM/SAM/GFF3 QC, NCBI retrieval,
BLAST, MAFFT, FastTree, nucleotide insights, bounded GWAS, exploratory
count-matrix expression and pathway over-representation. Execution models
vary: some browser-local, some private Codespaces only, and some require
six scientific workers or opt-in private large-file verifiers.

The connected database reported six core workers with stale heartbeats,
no active large-file verification workers and no enabled managed large-file
projects. Production readiness is not inferred from source code or CI.

## Full scientific rollout: phase-by-phase

| Phase | Domain | Main tool candidates | Definition of done |
|---|---|---|---|
| P0 | Operable science and safe AI chat | Existing queue fleet, private S3, audited action registry, immutable result verification | Live authorized FASTQ upload > verified analysis > downloadable artifact; all six core workers and designated file workers have fresh heartbeats; tenant isolation, cancellation and budgets exercised |
| P1 | Bulk RNA-seq | nf-core/rnaseq **3.27.0**, STAR/Salmon, tximport, DESeq2/edgeR | Genuine public FASTQ through QC, mapping/quantification and reference-bound count matrix, then separately validated differential expression design; real-data reference comparison |
| P2 | Germline/somatic WGS/WES | BWA-MEM2/minimap2, samtools, GATK/DeepVariant, bcftools, VEP/SnpEff, SV pipelines | FASTQ to aligned sorted/indexed BAM/CRAM, calls, quality metrics, independently benchmarked truth sets, and annotation with explicit reference versions |
| P3 | Single-cell and spatial | Scanpy/Seurat, STARsolo/Cell Ranger, assay-aware cell QC, validated integration | Real H5AD/raw 10x sample gives cells/genes QC, filtered matrix, clustering and marker evidence; spatial coordinates/images handled with explicit privacy |
| P4 | Epigenomics | ATAC/ChIP/CUT&Tag/methylation workflows | Assay-specific reference-bound read alignment, peak/methylation QC, and validated differential results |
| P5 | Metagenomics / microbiome | Kraken2/Bracken, MetaPhlAn, HUMAnN, 16S workflows | Genuine mock communities and controls pass classification/composition benchmarks; reference database revision stored |
| P6 | Proteomics / metabolomics | mzML readers, OpenMS, MSFragger/Comet, quant engines | Pinned mass-spectrometry benchmark, peptide/PSM FDR, genuine protein quantification and complete provenance |
| P7 | Protein structures, docking, dynamics | Reviewed structure predictor, PDB/mmCIF validation, AutoDock Vina, GROMACS/OpenMM | Known datasets, interpretable structural metrics and uncertainty, measured GPU/CPU budgets; never equate docking scores to approved drug efficacy |
| P8 | Population, comparative, regulatory and CRISPR genomics | PLINK2, REGENIE, SAIGE, phasing/imputation, assemblies/pangenomes, validated guide workflows | Real cohort/assembly benchmark, family/ancestry controls, organism/genome version identity and reproducibility |
| P9 | Multiomics and clinical boundary | Explicit cross-assay source metadata, external review, governance | Verified lineage and consent across datasets; clinical decision claims stay OFF unless independently validated under relevant regulation |
| P10 | Unified AI-directed pipeline execution | Nextflow/nf-core, durable per-project isolated jobs | Chat proposes only approved versioned actions, gets exact user consent and budget, executes with bounded resources, and reports only verified artifacts |

P0 infrastructure and P10 workflow architecture are cross-cutting and must
be built alongside each new domain. Each phase ships in smaller audited
releases, and cannot be marked complete after a single parser or UI change.

## First implemented release: V69 P1 samplesheet and design preflight

The authenticated /dashboard/rnaseq route accepts exactly two small CSV texts:
- nf-core/rnaseq sample sheet: sample, fastq_1, fastq_2, strandedness, with
  optional seq_platform and seq_center.
- Separate experimental design: sample, condition, one row per biological
  sample, never one row per sequencing lane.

The browser-only code validates strict CSV structure, consistent lane metadata,
safe relative FASTQ names, single/paired design, no reused file paths, sample
identity, unique matched condition assignment and per-group replication.
Biological samples and technical lanes are counted separately.
Bounds: 512 KiB per CSV, 12,000 lanes, 5,000 biological samples.
Canonical CSVs and a metadata-only provenance JSON can be downloaded locally.
The browser also computes source SHA-256 of each CSV text.

V69 does NOT open or hash FASTQ file bytes, verify library biology, authenticate
remote FASTQ paths, verify a reference FASTA/GTF, build a mapping index, run
Nextflow/STAR/Salmon/DESeq2, produce transcript counts or charge for compute.
Results explicitly say metadata_validated_not_executed and all compute-gate
flags remain false. Existing exploratory count-matrix analysis remains
available as a different tool. No database migration, secret or quota is added.

## Next P1 release: approved real FASTQ-to-counts execution

1. Resolve each fastq path to an authenticated private Genithm file ID and
   checksum. Refuse untrusted host paths or arbitrary network URLs.
2. Select, pin and independently verify reference genome FASTA, matching GTF,
   species and assembly; store immutable SHA-256 and release metadata.
3. Register and sandbox nf-core/rnaseq 3.27.0 (pinned revision), Nextflow and
   OCI tool digests; use only approved parameter combinations.
4. Require per-project CPU, RAM, scratch, time, cost and output quotas with
   human approval before every scientific run.
5. Execute a genuine source-verified public FASTQ dataset. Validate actual
   FastQC, quantification, mapping, counts, logs and source/reference hashes.
6. Keep count quantification separate from differential inference. For DESeq2
   or edgeR require proper biological replication and study design.
7. Store owner/project-scoped verified report outputs with explicit failure,
   cancellation, restart, cross-project and integrity regression tests.
8. Only then expose executable RNA-seq as available in Genithm chat.

## Non-negotiable release gates for every domain

- Scientific fidelity: benchmark real datasets and rejected malformed inputs,
  show independent expected observations and explicit limitations.
- Security: user/project permission at admission, during processing and on
  artifact reads; no untrusted commands, credentials or public genetic data.
- Resources: measured throughput, CPU/RAM/storage, upper-bound and cost guard.
- Provenance: exact input, reference, tool/container and output hashes, methods,
  warnings and signed-in viewer.
- Reliability: cancellation, partial uploads, retries, fenced leases and
  immutable result artifacts.
- UX: one Genithm conversation for requests, consent, progress and genuine
  artifacts; specialized labs remain available for precise settings.

External reference: nf-core/rnaseq 3.27.0 input contract at
https://nf-co.re/rnaseq/3.27.0/docs/usage and versioned pipeline at
https://registry.nextflow.io/pipelines/nf-core/rnaseq@3.27.0.

Do not provision paid services, change live quotas or deploy unapproved
runtime resources as a workaround for a missing scientific capability.


## Detailed checked status and progress page

The checked status of merged science modules, open release gates, and P0–P10
pending end-to-end requirements is maintained in
[the V73 scientific checklist](universal-bioinformatics-checklist-v73.md),
linked from the signed-in `/dashboard/capabilities` page. A checked module
is not proof its whole scientific domain is production ready.
