from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

CapabilityStatus = Literal["available", "planned"]
ExecutionKind = Literal["direct", "workflow", "planned"]

SCIENTIFIC_DOMAINS: tuple[str, ...] = (
    "sequences_annotation",
    "genomics",
    "variants_population",
    "transcriptomics",
    "single_cell_spatial",
    "epigenomics_regulation",
    "proteins_proteomics",
    "structure_protein_engineering",
    "drug_chemical_informatics",
    "microbial_pathogen",
    "systems_networks",
    "multi_omics_metabolism",
    "disease_precision_biology",
    "imaging_pathology",
    "ai_knowledge_workflows",
)


@dataclass(frozen=True, slots=True)
class ScientificCapability:
    capability_id: str
    domain: str
    label: str
    status: CapabilityStatus
    execution_kind: ExecutionKind
    action_type: str | None = None


_CAPABILITIES: tuple[ScientificCapability, ...] = (
    ScientificCapability("ncbi_sequence_retrieval", "sequences_annotation", "NCBI sequence retrieval", "available", "direct", "ncbi_sequence_retrieval"),
    ScientificCapability("blast", "sequences_annotation", "BLAST sequence search", "available", "direct", "blast"),
    ScientificCapability("pairwise_alignment", "sequences_annotation", "Pairwise sequence alignment", "available", "direct", "pairwise_alignment"),
    ScientificCapability("multiple_sequence_alignment", "sequences_annotation", "Multiple sequence alignment", "available", "direct", "multiple_sequence_alignment"),
    ScientificCapability("phylogenetic_tree", "genomics", "Phylogenetic tree inference", "available", "direct", "phylogenetic_tree"),
    ScientificCapability("protein_properties", "proteins_proteomics", "Protein physicochemical properties", "available", "direct", "protein_properties"),
    ScientificCapability("protein_annotation", "proteins_proteomics", "Protein annotation evidence", "available", "direct", "protein_annotation"),
    ScientificCapability("msa_phylogeny_workflow", "ai_knowledge_workflows", "MSA to phylogeny workflow", "available", "workflow", "msa_phylogeny_workflow"),

    ScientificCapability("orf_detection", "sequences_annotation", "Complete ORF discovery", "available", "direct", "sequence_insights"),
    ScientificCapability("motif_scan", "sequences_annotation", "IUPAC motif scanning", "available", "direct", "sequence_insights"),
    ScientificCapability("six_frame_translation", "sequences_annotation", "Six-frame nucleotide translation", "available", "direct", "sequence_insights"),
    ScientificCapability("reverse_complement", "sequences_annotation", "Reverse complement nucleotide sequence", "available", "direct", "sequence_insights"),
    ScientificCapability("primer_design", "sequences_annotation", "Primer and PCR design", "planned", "planned"),
    ScientificCapability("genome_assembly", "genomics", "Genome assembly", "planned", "planned"),
    ScientificCapability("genome_annotation", "genomics", "Genome annotation", "planned", "planned"),
    ScientificCapability("comparative_genomics", "genomics", "Comparative genomics", "planned", "planned"),
    ScientificCapability("pangenome_analysis", "genomics", "Pangenome analysis", "planned", "planned"),
    ScientificCapability("variant_calling", "variants_population", "Variant calling", "planned", "planned"),
    ScientificCapability("variant_annotation", "variants_population", "Variant annotation", "planned", "planned"),
    ScientificCapability("gwas", "variants_population", "Genome-wide association analysis", "planned", "planned"),
    ScientificCapability("population_genetics", "variants_population", "Population genetics analysis", "planned", "planned"),
    ScientificCapability("rna_seq_quantification", "transcriptomics", "RNA-seq quantification", "planned", "planned"),
    ScientificCapability("differential_expression", "transcriptomics", "Differential expression", "planned", "planned"),
    ScientificCapability("single_cell_rna_seq", "single_cell_spatial", "Single-cell RNA-seq analysis", "planned", "planned"),
    ScientificCapability("spatial_transcriptomics", "single_cell_spatial", "Spatial transcriptomics", "planned", "planned"),
    ScientificCapability("chip_seq", "epigenomics_regulation", "ChIP-seq analysis", "planned", "planned"),
    ScientificCapability("atac_seq", "epigenomics_regulation", "ATAC-seq analysis", "planned", "planned"),
    ScientificCapability("epitranscriptomics", "epigenomics_regulation", "Epitranscriptomics analysis", "planned", "planned"),
    ScientificCapability("mass_spec_proteomics", "proteins_proteomics", "Mass spectrometry proteomics", "planned", "planned"),
    ScientificCapability("protein_structure", "structure_protein_engineering", "Protein structure analysis", "planned", "planned"),
    ScientificCapability("protein_design", "structure_protein_engineering", "Computational protein design", "planned", "planned"),
    ScientificCapability("molecular_dynamics", "structure_protein_engineering", "Molecular dynamics", "planned", "planned"),
    ScientificCapability("molecular_docking", "drug_chemical_informatics", "Molecular docking", "planned", "planned"),
    ScientificCapability("computational_chemistry", "drug_chemical_informatics", "Computational chemistry", "planned", "planned"),
    ScientificCapability("metagenomics", "microbial_pathogen", "Metagenomics", "planned", "planned"),
    ScientificCapability("amr_analysis", "microbial_pathogen", "Antimicrobial resistance analysis", "planned", "planned"),
    ScientificCapability("viral_bioinformatics", "microbial_pathogen", "Viral bioinformatics", "planned", "planned"),
    ScientificCapability("host_pathogen", "microbial_pathogen", "Host-pathogen analysis", "planned", "planned"),
    ScientificCapability("immunoinformatics", "microbial_pathogen", "Immunoinformatics", "planned", "planned"),
    ScientificCapability("vaccine_informatics", "microbial_pathogen", "Vaccine informatics", "planned", "planned"),
    ScientificCapability("protein_interactions", "systems_networks", "Protein interaction analysis", "planned", "planned"),
    ScientificCapability("pathway_analysis", "systems_networks", "Pathway analysis", "planned", "planned"),
    ScientificCapability("network_medicine", "systems_networks", "Network medicine", "planned", "planned"),
    ScientificCapability("metabolomics", "multi_omics_metabolism", "Metabolomics", "planned", "planned"),
    ScientificCapability("lipidomics", "multi_omics_metabolism", "Lipidomics", "planned", "planned"),
    ScientificCapability("glycomics", "multi_omics_metabolism", "Glycomics", "planned", "planned"),
    ScientificCapability("multi_omics_integration", "multi_omics_metabolism", "Multi-omics integration", "planned", "planned"),
    ScientificCapability("cancer_bioinformatics", "disease_precision_biology", "Cancer bioinformatics", "planned", "planned"),
    ScientificCapability("pharmacogenomics", "disease_precision_biology", "Pharmacogenomics", "planned", "planned"),
    ScientificCapability("precision_medicine", "disease_precision_biology", "Precision medicine analysis", "planned", "planned"),
    ScientificCapability("toxicogenomics", "disease_precision_biology", "Toxicogenomics", "planned", "planned"),
    ScientificCapability("nutrigenomics", "disease_precision_biology", "Nutrigenomics", "planned", "planned"),
    ScientificCapability("imaging_bioinformatics", "imaging_pathology", "Imaging bioinformatics", "planned", "planned"),
    ScientificCapability("digital_pathology", "imaging_pathology", "Digital pathology", "planned", "planned"),
    ScientificCapability("knowledge_graph", "ai_knowledge_workflows", "Biomedical knowledge graph", "planned", "planned"),
    ScientificCapability("literature_mining", "ai_knowledge_workflows", "Scientific literature mining", "planned", "planned"),
    ScientificCapability("reproducible_workflows", "ai_knowledge_workflows", "Workflow management and reproducibility", "planned", "planned"),
)


def all_capabilities() -> tuple[ScientificCapability, ...]:
    return _CAPABILITIES


def available_capabilities() -> tuple[ScientificCapability, ...]:
    return tuple(capability for capability in _CAPABILITIES if capability.status == "available")


def executable_action_types() -> frozenset[str]:
    return frozenset(
        capability.action_type
        for capability in available_capabilities()
        if capability.action_type is not None
    )


def capabilities_by_domain(domain: str) -> tuple[ScientificCapability, ...]:
    if domain not in SCIENTIFIC_DOMAINS:
        raise ValueError(f"unknown scientific domain: {domain}")
    return tuple(capability for capability in _CAPABILITIES if capability.domain == domain)


def get_capability(capability_id: str) -> ScientificCapability:
    for capability in _CAPABILITIES:
        if capability.capability_id == capability_id:
            return capability
    raise ValueError(f"unknown scientific capability: {capability_id}")
