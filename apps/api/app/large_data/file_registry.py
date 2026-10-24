"""Versioned name hints, not a claim that every format has a scientific parser.

Unknown extensions are deliberately preservable as private inert bytes. Nothing
in this registry authorizes execution, deserialization, extraction or rendering.
"""
from __future__ import annotations

import unicodedata
from .policy import LargeDataError

LEGACY_VERSION = "genithm-file-registry/1"
VERSION = "genithm-file-registry/2"
# id | label | category | suffixes (longest match wins)
_ROWS = """
fasta|FASTA sequence or alignment|Sequences|fasta fa fna ffn faa frn fas fsa
fastq|FASTQ reads|Sequences|fastq fq
sra|Sequence Read Archive|Sequences|sra
fast5|FAST5 signal container|Long reads|fast5
pod5|POD5 signal container|Long reads|pod5
slow5|SLOW5 signals|Long reads|slow5
blow5|BLOW5 signals|Long reads|blow5
qual|Sequence qualities|Sequences|qual
ab1|ABI chromatogram|Sequences|ab1 abi
scf|SCF chromatogram|Sequences|scf
genbank|GenBank annotated sequence|Annotations|gb gbk genbank gbff gp gpf
embl|EMBL flat file|Annotations|embl emblflat
sam|SAM alignments|Alignments|sam
bam|BAM alignments|Alignments|bam
cram|CRAM alignments|Alignments|cram
paf|Pairwise mapping|Alignments|paf
maf|Multiple alignment|Alignments|maf
psl|PSL alignment|Alignments|psl pslx
clustal|Clustal alignment|Alignments|aln clustal clu
stockholm|Stockholm alignment|Alignments|sto stockholm
phylip|PHYLIP alignment|Alignments|phy phylip
nexus|NEXUS data|Phylogenetics|nex nexus nxs
newick|Newick tree|Phylogenetics|nwk newick tree tre treefile contree
vcf|VCF variants|Variants|vcf g.vcf
bcf|BCF variants|Variants|bcf
gff|GFF annotations|Annotations|gff gff3
gtf|GTF annotations|Annotations|gtf
bed|BED intervals or PLINK binary data (ambiguous)|Genomics|bed
bedgraph|bedGraph signal|Genomics|bedgraph bdg
wig|WIG signal|Genomics|wig wiggle
bigwig|bigWig signal|Genomics|bw bigwig
bigbed|bigBed intervals|Genomics|bb bigbed
peaks|Peak calls|Genomics|narrowpeak broadpeak gappedpeak
intervals|Interval list|Genomics|interval_list intervals
index|Sequence, alignment or variant index|Indexes|fai gzi bai crai csi tbi idx dict
bowtie_index|Bowtie index component|Indexes|bt2 bt2l ebwt ebwtl
bwa_index|BWA index component|Indexes|amb ann bwt pac sa
hisat_index|HISAT index component|Indexes|ht2 ht2l
gfa|Genome assembly graph|Genome graphs|gfa gfa1 gfa2 rgfa
fastg|FASTG assembly graph|Genome graphs|fastg
gaf|Graph alignment|Genome graphs|gaf
vg|Variation graph container|Genome graphs|vg xg gbz gbwt snarls
plink|PLINK genotype component|Population genetics|bim fam ped pgen pvar psam
bgen|BGEN genotypes|Population genetics|bgen sample
h5ad|AnnData container|Single-cell and spatial|h5ad
h5mu|MuData container|Single-cell and spatial|h5mu
loom|Loom container|Single-cell and spatial|loom
hdf5|HDF5 container|Scientific containers|h5 hdf5 hdf hdf5file
zarr|Zarr metadata or component|Scientific containers|zarr zarray zattrs zgroup zmetadata
mtx|Matrix Market matrix|Expression and tables|mtx
rds|R serialized object|Expression and tables|rds rda rdata
csv|Comma-separated table|Expression and tables|csv
tsv|Tab-separated table|Expression and tables|tsv tab
excel|Excel workbook|Expression and tables|xlsx xls
parquet|Parquet table|Expression and tables|parquet pq
arrow|Arrow or Feather table|Expression and tables|arrow feather
gct|GCT expression matrix|Expression and tables|gct gctx
pdb|PDB coordinates|Structures|pdb ent
mmcif|mmCIF coordinates or data|Structures|cif mmcif
bcif|BinaryCIF container|Structures|bcif
mmtf|MMTF structure container|Structures|mmtf
map|Genetic map or density map (ambiguous)|Scientific containers|map
mrc|MRC or CCP4 density map|Structures|mrc ccp4
sdf|Structure data file|Chemistry|sdf sd
mol|MOL or MOL2 structure|Chemistry|mol mol2
smiles|SMILES or SMARTS text|Chemistry|smi smiles sma smarts
pdbqt|PDBQT coordinates|Chemistry|pdbqt
mzml|mzML mass spectra|Proteomics|mzml
mzxml|mzXML mass spectra|Proteomics|mzxml
mgf|Mascot generic spectra|Proteomics|mgf
mzid|mzIdentML identifications|Proteomics|mzid mzidentml
mztab|mzTab results|Proteomics|mztab
pepxml|pepXML identifications|Proteomics|pep.xml pepxml
protxml|protXML identifications|Proteomics|prot.xml protxml
traml|TraML transitions|Proteomics|traml
vendor_raw|Vendor-specific raw data|Instrument data|raw wiff d
fcs|Flow cytometry data|Instrument data|fcs
imzml|Imaging mass spectra|Instrument data|imzml ibd
hic|Hi-C contact map|Chromatin|hic
cool|Cooler contact matrix|Chromatin|cool mcool scool
json|JSON data|Metadata and workflows|json jsonl ndjson
xml|XML data|Metadata and workflows|xml
yaml|YAML metadata or workflow|Metadata and workflows|yaml yml
workflow|Workflow source (never executed on upload)|Metadata and workflows|nf smk snakefile wdl cwl
notebook|Notebook (never executed on upload)|Metadata and workflows|ipynb rmd qmd
script|Research source (never executed on upload)|Metadata and workflows|py r sh jl pl
text|Plain text or metadata|Metadata and workflows|txt text md log out
pdf|PDF research document|Documents and images|pdf
docx|Word research document|Documents and images|docx doc
image|Research image|Documents and images|png jpg jpeg tif tiff ome.tif ome.tiff svg webp
archive|Archive (stored, never extracted on upload)|Archives|zip tar tgz tbz tbz2 txz 7z rar
unknown|Other research file|Other|bin dat
""".strip()

FORMATS = tuple(dict(zip(("id", "label", "category", "extensions"), row.split("|"))) for row in _ROWS.splitlines())
for _item in FORMATS:
    _item["extensions"] = _item["extensions"].split()
BY_ID = {item["id"]: item for item in FORMATS}
SUFFIXES = sorted(((ext, item["id"]) for item in FORMATS for ext in item["extensions"]), key=lambda x: len(x[0]), reverse=True)
COMPRESSION = {"gz": "gzip", "gzip": "gzip", "bgz": "gzip", "bgzf": "gzip", "bz2": "bzip2", "xz": "xz", "zst": "zstd", "zstd": "zstd", "lz4": "lz4"}
HEADER_KINDS = {"unknown", "gzip", "bzip2", "xz", "zstd", "zip", "7zip", "rar", "hdf5", "cram", "bam", "bcf", "sqlite", "pdf", "elf", "pe", "fasta_hint", "vcf_hint", "gff_hint", "sam_hint", "nexus_hint", "clustal_hint", "stockholm_hint"}


def validate_path(filename: str, relative_path: str | None = None) -> str:
    def clean(value: str, maximum: int):
        return (isinstance(value, str) and 1 <= len(value) <= maximum and value == value.strip()
                and not any(unicodedata.category(c) in {"Cc", "Cf", "Cs"} for c in value)
                and not any(c in value for c in ("\\", ":")))
    if not clean(filename, 255) or filename in {".", ".."} or "/" in filename:
        raise LargeDataError("invalid_filename", 422)
    path = relative_path if relative_path is not None else filename
    if (not clean(path, 1024) or path.startswith("/") or path.split("/")[-1] != filename
            or any(not clean(part, 255) or part in {".", ".."} for part in path.split("/"))):
        raise LargeDataError("invalid_relative_path", 422)
    return path


def describe(filename: str, *, registry_version: str = VERSION) -> dict:
    if registry_version not in {LEGACY_VERSION, VERSION}:
        raise ValueError("Unknown versioned scientific format registry")
    name = filename.lower()
    compression = "none"
    ext = name.rsplit(".", 1)[-1]
    if ext in COMPRESSION:
        compression, name = COMPRESSION[ext], name[:-(len(ext) + 1)]
    format_id = next((fid for suffix, fid in SUFFIXES if name.endswith("." + suffix) or name == suffix or name == "." + suffix), "unknown")
    item = BY_ID[format_id]
    action = "integrity_only"
    if compression in {"none", "gzip"} and format_id in {"fasta", "fastq"}:
        action = "complete_" + format_id
    elif registry_version == VERSION and compression in {"none", "gzip"} and format_id == "vcf":
        # Historical V47 VCF rows were integrity-only: their recorded hints
        # continue to validate under LEGACY_VERSION without retroactive change.
        action = "complete_vcf"
    return {"format_id": format_id, "label": item["label"], "category": item["category"],
            "compression_hint": compression, "available_inspection": action, "name_is_not_validation": True}


def storage_format(filename: str, mode: str) -> str:
    hint = describe(filename)
    if mode == "auto" and hint["available_inspection"] == "complete_fastq":
        return "fastq.gz" if hint["compression_hint"] == "gzip" else "fastq"
    return "opaque"


def header_kind(prefix: bytes) -> str:
    signatures = ((b"\x1f\x8b", "gzip"), (b"BZh", "bzip2"), (b"\xfd7zXZ\x00", "xz"),
        (b"\x28\xb5\x2f\xfd", "zstd"), (b"PK\x03\x04", "zip"), (b"PK\x05\x06", "zip"),
        (b"7z\xbc\xaf\x27\x1c", "7zip"), (b"Rar!\x1a\x07", "rar"), (b"CRAM", "cram"),
        (b"BAM\x01", "bam"), (b"BCF\x02", "bcf"), (b"SQLite format 3\x00", "sqlite"),
        (b"%PDF-", "pdf"), (b"\x7fELF", "elf"), (b"MZ", "pe"), (b">", "fasta_hint"),
        (b"##fileformat=VCF", "vcf_hint"), (b"##gff-version", "gff_hint"), (b"@HD\t", "sam_hint"),
        (b"@SQ\t", "sam_hint"), (b"#NEXUS", "nexus_hint"), (b"CLUSTAL", "clustal_hint"),
        (b"# STOCKHOLM", "stockholm_hint"))
    for magic, kind in signatures:
        if prefix.startswith(magic):
            return kind
    for offset in (0, 512, 1024, 2048, 4096, 8192, 16384, 32768):
        if prefix[offset:offset + 8] == b"\x89HDF\r\n\x1a\n":
            return "hdf5"
    return "unknown"


def catalog() -> dict:
    return {"version": VERSION, "accepts_unknown_extensions": True, "maximum_batch_files": 100,
        "formats": [{**item, "extensions": list(item["extensions"])} for item in FORMATS],
        "compression_suffixes": list(COMPRESSION), "automatic_execution": False,
        "automatic_archive_extraction": False, "malware_scanning_available": False}
