# Genithm V60: real sequence preprocessing and open-reading-frame exploration in chat

V60 is a *working*, bounded next stage after V59 FASTQ/VCF/FASTA QC, integrated
into the authenticated, owner/project-scoped V58 chat-execution worker.
It is not a new generic-purpose LLM-generated computation framework. Every
statistics number and result file comes from deterministic, validated code.

## 1. FASTQ preprocessing from a chat message

**Example:** Attach a single `.fastq`, `.fq` or `.fastq.gz` (or correctly named
`sample_R1.fastq.gz` and `sample_R2.fastq.gz`) and write:

> Trim the adapters and low-quality tails, then give me cleaned FASTQ files.

After explicitly consenting to *temporary private Codespaces computation*, the
scientific engine verifies all Phred+33 reads with the existing V39 FASTQ
validator and validates mate identity/order. It performs a fixed, reproducible,
conservative protocol:

1. Clip before the first exact 13-base Illumina adapter seed `AGATCGGAAGAGC`.
   If that exact seed is not present, **no adapter is asserted or removed**.
2. Starting at the right end, repeatedly remove the last nucleotide while
   the mean Phred score of the rightmost four bases (or remaining bases) is
   less than Q20.
3. Discard reads shorter than 30 bases. For paired-end reads, discard both
   mates if either fails, preserving original paired ordering.
4. Re-run the actual Phred+33 QC engine on the retained sequences and report
   measured before/after bases, Q30 bases and read retention.

**Real deliverables:** `trimmed_R1.fastq.gz`, optionally
`trimmed_R2.fastq.gz`, `trimming-summary.tsv`, `post-trim-qc.tsv`,
`read-retention.svg`, source SHA-256 provenance, methods and the ZIP bundle.
Output reads are genuine transformed read records, not simulated examples.

**Limitations:** exact adapter seed matching can miss short, variant,
mismatched, reverse-complement or library-specific adapter sequences. The
fixed threshold, window and length are not customizable by text prompts; use a
specialist read preprocessing pipeline when a study needs flexible cutoffs,
paired-overlap correction, poly-G trimming, adapter discovery or rigorous
contamination screening. Not a replacement for cutadapt/fastp.

## 2. Six-frame ORF exploration from uploaded nucleotide FASTA

**Example:** Attach a DNA/RNA multi-record FASTA (`.fna`, `.fa`, `.fasta`,
optional gzip) and write:

> Find the open reading frames in this nucleotide sequence and translate
> the candidate proteins.

The engine uses **all six reading frames** (plus and reverse-complement
minus), the standard nuclear/canonical genetic code (translation table 1),
`ATG` start and in-frame `TAA`, `TAG` or `TGA` stops, fixed minimum 30 amino
acids. It selects the first ATG after the previous stop in each frame
(one longest ORF per stop-delimited reading-frame segment); nested shorter
starts are **not** enumerated. Ambiguous codons terminate a candidate.

**Real deliverables:** `orfs.tsv` with 1-based inclusive reference coordinates,
strand/frame and length; `orfs.gff3` with **putative_ORF**, *not verified CDS*
features; translated `proteins.faa` protein sequence records;
`orf-lengths.svg`, source SHA-256 provenance, methods and ZIP. The protein FASTA
may legitimately be empty when no ORF meets the fixed cutoff; that is a valid
zero-hit finding, not an output error.

**Limitations:** ORF discovery alone is **not gene annotation**. No splice
junctions, altered genetic codes, non-ATG bacterial starts, internal ribosome
entry, RNA editing, frameshifts, overlapping/nested alternative starts,
protein functional annotation, circular-genome wraparound, or homology
confirmation are performed. Some genuine genes may be missed; random ORFs
may be found in noncoding sequence. Verify putative genes using organism-
specific validated tools and independent genomic evidence before publication.

## 3. Private compute, limits and speed

Both pathways inherit authenticated Supabase project access, **explicit**
researcher opt-in before browser bytes leave the browser, the existing bounded
Codespaces subprocess without API keys, integrity-checked run output, account-
and project-scoped download links, 48-hour expiry, full original-file removal
after execution, and refusal to claim a completed run without a signed worker
manifest. Neither private reads nor sequence text is placed in LLM prompts.

Input limits: 12 MiB **decompressed** per FASTQ mate and at most 100,000 reads
per mate; 32 MiB decompressed nucleotide FASTA, at most 50,000 contigs,
50,000 reported ORFs and five million translated residues. All result files
are bounded to 30 MB. Each user job has the existing 150-second deadline.
This remains a **private Codespaces Node runner**; it is not a Cloudflare-edge
or production distributed compute service.

The V60 result-manifest schema preserves V58/V59 manifests for their existing
48-hour expiration period, and accepts new `genithm-chat-science/1.2.0` outputs.

## 4. Verification

- `node --experimental-strip-types --test scripts/tests/test_sequence_preprocessing_v60.mjs`
- Existing V59 FASTQ/VCF/FASTA QC and V58 public-airway, GWAS, expression,
  pathways and V55 file-privacy regression suites
- Verified full CLI end-to-end execution for both new sciences and SHA-256 of
  each output in the manifest; archived FASTQ and GFF/protein outputs checked
- GitHub Actions full Next.js typecheck, production build, security-policy,
  API/AI-worker and browser workflow checks

V60 introduces no database schema change, no additional keys and no automatic
scientific action performed outside the user's explicitly supported methods.
