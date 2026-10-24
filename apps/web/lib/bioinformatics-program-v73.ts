/** Genithm's audited scientific delivery program. Never infer "available"
 * from a menu entry or a passing unit test. Production readiness is dynamic
 * and must be inspected separately at /dashboard/operations.
 */
export type ProgramState="partial"|"blocked"|"not_started";
export type ProgramPhase={id:`P${number}`;title:string;state:ProgramState;
  implemented:string[];remaining:string[];completion_rule:string};
export const BIOINFORMATICS_PHASES:ProgramPhase[]=[
 {id:"P0",title:"Scientific infrastructure and private data",state:"blocked",
 implemented:["GitHub code for six scientific workers and versioned private upload verification exists", "V68 worker Compose deployment template merged"],
 remaining:["Bring six core scientific workers online with fresh authenticated heartbeats", "Deploy private large-file and paired-file workers", "Provision private object storage and enable per-project quotas", "Demonstrate tenant-isolated, authorized upload → analysis → verified report with interruption and resource tests"],
 completion_rule:"Live operator-verified end-to-end processing, privacy and budget evidence"},
 {id:"P1",title:"Bulk RNA-seq from reads to gene statistics",state:"partial",
 implemented:["V69 sample-sheet and experimental design preflight merged", "V70 existing Salmon quant.sf transcript-level TPM/fragment import merged", "V71–V72 gene summaries, GTF mapping and descriptive cohort QC merged as PR #265", "V73 researcher-design reconciliation with measured cohort correlations merged as PR #266"],
 remaining:["Bind actual verified FASTQ bytes and immutable reference transcriptome/index data", "Run pinned nf-core/rnaseq or validated STAR/Salmon workflow under user-approved compute", "Perform reference-appropriate gene-level length correction/tximport and legitimate DESeq2/edgeR analysis", "Validate public truth-data results, scientific provenance, job cancellation and output privacy"],
 completion_rule:"Reproducible real FASTQ → validated transcript/gene counts → justified differential model"},
 {id:"P2",title:"Whole-genome / exome sequencing",state:"partial",implemented:["Bounded SAM/BAM and VCF quality-control modules exist"],
 remaining:["Production read alignment, BAM/CRAM sorting/indexing", "Germline/somatic variant calling with truth-set benchmarks", "Annotation, SV/CNV calling, versioned references and reproducible artifacts"],completion_rule:"Verified raw reads to benchmarked, annotated variant call sets"},
 {id:"P3",title:"Single-cell and spatial",state:"not_started",implemented:[],remaining:["True cell calling, single-cell QC, normalization, clustering and biological marker validation", "Spatial coordinates, images, batch integration and independent assay truth sets"],completion_rule:"Real assay-specific single-cell/spatial results with controls"},
 {id:"P4",title:"Epigenomics",state:"not_started",implemented:[],remaining:["ATAC/ChIP/CUT&Tag alignment, peaks and controls", "Methylation detection, reference matching and assay-specific differential results"],completion_rule:"Benchmark assay-specific read-to-peak/methylation workflows"},
 {id:"P5",title:"Metagenomics and microbiome",state:"not_started",implemented:[],remaining:["Sequence classification and reference database pinning", "16S/shotgun mock-community controls, binning/function profiles and contamination QC"],completion_rule:"Measured mock-community accuracy and reproducible taxonomic profiles"},
 {id:"P6",title:"Proteomics and metabolomics",state:"not_started",implemented:[],remaining:["Native mass-spectrometry scientific parsing", "PSM/peptide FDR, protein inference and quantification benchmarks"],completion_rule:"Authentic LC-MS/MS evidence and calibrated scientific outputs"},
 {id:"P7",title:"Structures, docking and molecular dynamics",state:"partial",implemented:["Protein sequence property and limited reference-annotation tools exist"],
 remaining:["Real structure prediction and geometry validation", "Docking benchmarking without overclaiming affinity", "Resource-limited molecular dynamics with validated trajectories"],completion_rule:"Measured structural benchmark performance and bounded execution"},
 {id:"P8",title:"Population/comparative/regulatory genomics",state:"partial",implemented:["Bounded exploratory GWAS and sequence comparison tools exist"],
 remaining:["Kinship-aware GWAS, phasing/imputation and population-structure controls", "Assemblies, pangenomes, synteny and validated CRISPR off-target analysis"],completion_rule:"Benchmark cohorts, assembly matching and independent association/reference checks"},
 {id:"P9",title:"Cross-omics and clinical governance",state:"partial",implemented:["Project-scoped reports, hashes and descriptive provenance exist"],
 remaining:["Cross-assay consent and lineage checks", "Independent clinical validation and regulated review for any medical conclusions"],completion_rule:"Reproducible cross-omics lineage; no unvalidated clinical claims"},
 {id:"P10",title:"General AI-directed scientific workflow execution",state:"partial",implemented:["Supported chat actions, workflow plans and limited worker execution exist"],
 remaining:["One general version-pinned Nextflow/nf-core execution registry with project-approved inputs", "User confirmation of compute budget, cancellation, retries and fenced leases", "Signed-in chat showing independently verified real artifacts across all domains"],completion_rule:"Audited human-approved end-to-end multi-domain execution from chat"}
];
export const MERGED_MILESTONES=[
 {version:"V64–V68",what:"VCF/GFF3 managed-file QC, verified chat summaries, safe numeric comparisons, optional worker container template"},
 {version:"V69",what:"Bulk RNA-seq metadata and sample/design preflight"},
 {version:"V70",what:"Real import of existing Salmon transcript quantification"},
 {version:"V71–V72",what:"Validated Salmon transcript-to-gene sums, GTF mappings and descriptive cohort QC (PR #265 merged)"},
 {version:"V73",what:"Matched biological-study design and measured within/between-cohort QC; in-app P0–P10 checklist (PR #266 merged)"}
];
export const PARTIAL_MILESTONES:Array<{version:string;what:string;reference:string}>=[];
export function validateProgramPhases(phases:readonly ProgramPhase[]=BIOINFORMATICS_PHASES){
 const expected=Array.from({length:11},(_,i)=>`P${i}`);
 if(phases.length!==11||phases.some((x,i)=>x.id!==expected[i]))throw Error("Program must contain exactly P0–P10 in order.");
 if(phases.some(x=>!x.remaining.length||!x.completion_rule))throw Error("No phase may be called finished without independently verified release acceptance.");
 return true;
}
