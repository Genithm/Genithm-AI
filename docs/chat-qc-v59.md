# Genithm V59: real FASTQ, VCF and FASTA analysis directly in BioAI chat

## Why

Previous chat versions had real VCF and FASTQ QC laboratories but would still
show only metadata or tell researchers to open a separate page when the
researcher attached one FASTQ/VCF/FASTA. This release bridges those validated
analyzers into the same authenticated, file-driven scientific worker and chat
artifact system introduced in V58. This does **not** claim to run arbitrary
bioinformatics analyses on every file format.

## Supported science

| User request and attachments | Executed engine | Actual deliverables |
|---|---|---|
| Run FASTQ QC with one `.fastq`, `.fq`, or gzip-compressed FASTQ | V39 Phred+33 parser, all reads, base/length/quality distributions | `fastq-qc.tsv`, `quality-by-cycle.svg`, `read-lengths.svg`, summary, source provenance, methods and ZIP |
| Run paired FASTQ QC with two R1/R2-named mate files | Same validated parser plus exact mate IDs/order and read-count checks | Same exports, separate R1/R2 statistics, mate validation |
| Analyze a `.vcf` or `.vcf.gz` | V38 strict VCF v4 parser; site variants, Ti/Tv, FILTER and QUAL bands | `vcf-qc.tsv`, `variant-types.svg`, summary/provenance and ZIP |
| Analyze a DNA/RNA/protein `.fasta`, `.fa`, `.fna`, `.faa` or gzip FASTA | New bounded multirecord parser: lengths, N50/L50/N90/L90, nucleotide GC or protein symbol counts | `fasta-stats.tsv`, `sequence-lengths.svg`, summary/provenance and ZIP |

The UI uses a **real scientific-execution route** only when it identifies a
matching file format and user-requested QC, and after the researcher explicitly
approves private scientific processing. Otherwise attachments remain local
preview material. Crucially a BLAST request with FASTA is **not** silently
changed into FASTA QC, and a GWAS request with VCF is **not** silently changed
into VCF QC. The existing NCBI/BLAST/alignment and GWAS/omics flows remain.

## Security, accuracy and speed

- Inputs stay in the browser unless the private compute checkbox is selected.
  The existing authenticated, project-scoped Codespaces Node worker receives
  the original bytes, never the Gemini/Groq model. Uploaded raw files are
  deleted after the run; output files remain private for 48 hours.
- Supports gzip through **signature detection**, with `maxOutputLength` limits
  to prevent gzip decompression bombs. No arbitrary compressed formats or
  LLM-generated shell commands are executed.
- Complete-file ceilings: 12 MiB per mate (FASTQ), 8 MiB VCF, 32 MiB FASTA.
  In addition, the inherited validated FASTQ/VCF parsers enforce record/read
  limits; partial sampled data are never called whole-file results.
- Every output is stored with a SHA-256 checksum. Each original input is
  recorded by its *actual original byte hash*, including compressed bytes.
  The server rechecks owner, active project membership and artifact digests
  before download. No raw read names/qualities or genotypes are placed in the
  assistant response or normal LLM request.
- Spreadsheet formula-like sequence IDs are neutralized in TSV exports.
  User-supplied labels are XML-escaped in SVGs.
- Validated engine outputs may be downloaded individually and in a ZIP in the
  same chat. Earlier V58 result archives remain eligible for authenticated
  download during their original 48-hour expiry, with versioned manifest
  compatibility.
- FASTQ uses the already-tested V39 parser; VCF uses the V38 parser. New FASTA
  summaries are checksummed and independently regression-tested.
- On local Node 22 fixtures, 10k FASTQ reads required roughly 70-95 ms and
  5k VCF records 15-25 ms. These are fixture measurements, not a performance
  SLA. Actual runtimes depend on device and data; public studies retain the
  source-verified cache introduced in V57/V58.

## Limitations

FASTQ QC does **not** perform read trimming, adapter detection, mapping,
sequencing basecalling, taxonomic classification, or reference variant calls.
VCF QC does **not** analyze GT/genotype quality or pathogenicity, and VCF
files with more than 50,000 records or 8 MiB uncompressed are out of scope.
FASTA N50/GC is descriptive and **not** proof of assembled-genome accuracy,
completeness or taxonomic identity. Protein vs nucleotide symbols are inferred
from the FASTA alphabet, not by annotation databases. Scientific analysis
remains restricted to a private configured Codespace rather than a Cloudflare
edge server. Compressed BAM/CRAM, H5AD, mzML and other specialized files still
require their own validated analysis integrations.

## To verify

`node --experimental-strip-types --test scripts/tests/test_chat_qc_v59.mjs`

The suite covers Phred33/Q30, paired-end mates, gzip bombs, VCF Ti/Tv,
indel/FILTER parsing, nucleotide and protein FASTA, N50/L50, TSV injection,
source hashes, actual ZIP/manifest creation, worker isolation, and chat result
links. `.github/workflows/chat-qc-v59.yml` must pass along with the existing
V58 scientific execution and normal web typecheck/production build before
merge. Live private Codespace authentication still needs validation after
`git pull` and restart; no tests pretend they have authenticated to a user's
private account.
