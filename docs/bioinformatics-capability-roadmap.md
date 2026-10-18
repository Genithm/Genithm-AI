# Genithm: broad scientific coverage with measured execution

## Product contract

One desktop/laptop AI-native research workspace, using the approved Genithm
light theme and logo. The chat should plan and explain research; pinned,
authorized scientific executors must compute the evidence. Language-model
confidence, a new menu item, or a pipeline stub is not a scientific result.

"Every bioinformatics task" is the coverage direction, not a present-day
capability claim. Each supported workflow needs compatible data formats,
reference datasets, explicit methods, scientific tests, resource limits,
provenance, and a working end-to-end execution path.

## Current implementation versus planned coverage

| Domain | Current implementation | Expansion work, not yet shipped |
|---|---|---|
| Sequence data | FASTA validation/statistics; V42 single-pass streaming ingestion | Resumable multipart imports, compressed/large-file policies, cohort manifests |
| Sequence research | Approved pairwise alignment, multiple alignment, phylogeny, nucleotide insights, protein properties and BLAST pathways | Larger-scale similarity search, assemblies, richer annotations |
| Read and variant QC | Bounded local FASTQ/VCF inspection and optional aggregate history | V44/V45 add managed full-file and paired-input verification (separately enabled). Cohort QC, trimming, BAM/CRAM processing remain planned |
| Bulk RNA-seq | No complete alignment-to-differential-expression pipeline | Sample design, alignment/quantification, counts, statistical contrasts, enrichment |
| Genomics | VCF QC is not variant calling | Germline/somatic workflows, reference consistency, annotation and cohort analysis |
| Single-cell/spatial | Not implemented | Assay-aware QC, normalization, integration, clustering, annotation and spatial analysis |
| Microbiome/metagenomics | Not implemented | Taxonomy, assembly/binning, functional profiling and comparative statistics |
| Epigenomics | Not implemented | ATAC/ChIP/methylation workflows and reproducible differential testing |
| Structural/proteomics | Protein properties are not structure prediction or proteomics | Structure services, docking where scientifically justified, mass-spec workflows |
| Research delivery | Verified artifacts, result views, comparisons, saved studies and notebook | Cross-workflow cohort reports and reproducible analysis packages |

This inventory distinguishes implemented source from installed/running services.
Availability still depends on the deployed revision, authorized inputs and
healthy workers. This document is not an advertisement of unimplemented tools.

## Next major functional milestone: managed bulk RNA-seq

Reuse a version-pinned, validated workflow ecosystem rather than inventing new
statistics or replacing established scientific methods with model-generated
numbers. Nextflow and curated nf-core workflows are integration candidates,
not dependencies secretly enabled by this release.

A complete Genithm RNA-seq milestone must include:

1. Project-scoped samples, FASTQ/BAM metadata, strandedness, reference-genome and
   gene-annotation checks; biological replicates and explicit study contrasts.
2. Approved resource/cost plan, isolated task containers, actual QC and
   alignment/quantification execution, real logs and cancellation semantics.
3. Separate validated differential-abundance analysis of the count matrix;
   expression quantification alone must not be labelled differential expression.
4. Integrity-checked outputs, explicit tool/reference versions, reproducible
   reports and comparison with an independent expected-results dataset.
5. A real upload-to-worker-to-report acceptance test, including failure,
   interrupted-run recovery and unauthorized-access tests before availability.

The official nf-core RNA-seq documentation explicitly separates quantification
from downstream statistical comparison. Sarek covers a distinct germline/somatic
variant workflow and must not be treated as interchangeable with VCF QC.

## Performance architecture and release gates

- Measure upload, queue, execution, validation and report latency separately;
  publish cold/warm timings, input sizes, CPU/RAM and output-equivalence evidence.
- Use bounded streaming, native/vectorized tools and resource-aware parallelism.
  Keep conservative defaults; a setting does not provision additional compute.
- Add checkpoint/resume only with fenced task ownership and durable artifacts.
  Do not replay an ambiguous claim or commit; prevent duplicate execution/results.
- Reuse validated results only within authorized scopes. Cache keys must bind
  actual input content, parameters, tool/container versions and reference
  versions. Recheck permissions and verify artifacts before reuse.
- Classify exploratory previews separately from completed validated outputs.
  Large workloads may require hours or more; display measured/qualified ETA,
  not invented progress percentages or promises of instant completion.
- Keep new tools unavailable until scientifically verified, deployment-tested,
  quota-controlled and integrated into the existing approval/audit system.

Nextflow already supports task caches and resume, but reuse requires both a
matching task and retained valid output files. Integrating those facilities
must still preserve Genithm's tenant isolation, permissions and provenance.

## Primary integration references (consulted 2026-10-17)

- https://nf-co.re/rnaseq/3.27.0 (quantification versus downstream differential analysis)
- https://nf-co.re/sarek/latest/ (germline/somatic workflow scope)
- https://docs.seqera.io/nextflow/cache-and-resume (task identity, work directories and resume)

No new RNA-seq, Sarek, Nextflow, single-cell or GPU executor is claimed as shipped
by this roadmap. V42 ships the measured FASTA-ingestion improvement only.
