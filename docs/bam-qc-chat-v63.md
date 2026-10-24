# Genithm V63 — Native binary BAM quality control directly from AI chat

**Researcher workflow:** attach exactly one genuine `.bam` file to a Genithm research project, ask Genithm to analyze mapping quality, alignment flags, CIGAR statistics and reference coverage, then explicitly approve temporary private Codespaces processing. BAM data is not sent to Gemini or Groq.

## What actually runs
The scientific subprocess parses the uploaded **BGZF-compressed binary BAM**, not renamed text SAM. It verifies individual BGZF BC block-size fields, 64-KiB uncompressed member bounds, 20-MiB aggregate expansion limit, gzip CRCs, BAM magic, reference dictionary and each binary alignment block. It parses alignment FLAG, reference ID, zero-based POS, MAPQ, packed CIGAR operations, mate fields, sequence/quality byte counts and optional tags. Long-CIGAR `CG` records are rejected because the bounded scientific engine does not yet implement them.

It then reuses the reviewed V62 SAM scientific calculations via a **private synthetic alignment interchange**. The interchange uses dummy read names and no original nucleotide sequence or base qualities. Genuine parsed CIGAR/query-length integrity is checked before conversion. All exported statistics derive from actual binary input; no statistics are fabricated by an LLM.

Calculations include mapped/unmapped primary alignments; secondary, supplementary, duplicate and paired FLAG counts; MAPQ bins and mean excluding 255 (unknown); total CIGAR operations; and the **union of M/= /X reference alignment spans** per reference, excluding D/N gaps. The output is a measured, bounded alignment QC, not unique read/fragment counts, base-depth, variant calling, gene expression, contamination detection or clinical interpretation.

## Downloadable artifacts
`bam-mapping-qc.tsv`, `bam-reference-coverage.tsv`, `bam-cigar-operations.tsv`, `bam-mapq.svg`, `summary.json`, `provenance.json`, `METHODS.md`, and `complete-results.zip`. These run through Genithm's existing authenticated, owner-and-project-scoped, SHA-256 verified 48-hour artifact endpoint. Provenance includes original compressed BAM SHA-256 and byte count. No original read names or bases are written to any artifact.

## Explicit, fail-closed limits and caveats
- Input BAM **12 MiB maximum compressed**; decompressed BAM **20 MiB maximum**; internal QC interchange **12 MiB maximum**. At most **120,000 alignment records**, **2,000 references**, **256 CIGAR operations per alignment** and **50,000 sequence bases per alignment**.
- Standard `.bam` only. BAM is already BGZF compressed; plain `.sam` is analyzed by the older SAM engine. Ordinary gzip of a BAM payload is rejected. CRAM/BCF/BAM indexing, reference FASTA checks, long `CG` CIGARs, library/library-size inference and very large BAM datasets are **not** supported.
- A missing conventional BGZF EOF member is reported as a truncation warning, not hidden. Malformed/tampered BGZF or BAM records fail without a misleading successful result.
- The worker receives no provider secrets. The source is deleted from temporary compute input after analysis; only derived files are retained for 48 hours.
- This is **private Codespaces compute**, not the globally hosted Cloudflare worker. No new Supabase schema, secrets, subscriptions, branding or interface redesign.

## Verification

`node --experimental-strip-types --test scripts/tests/test_bam_qc_v63.mjs`

Real in-memory fixtures assemble authentic BGZF blocks and binary BAM records, covering mapping flags, CIGAR indels/introns, overlapping reference coverage, MAPQ unknown, multiple gzip members, source hashes, privacy, malformed blocks, CRC/tampering, truncation, unsupported tags, role routing and an **actual isolated worker ZIP/manifest execution**. CI also runs the V62–V59 regression suites. Reference: GA4GH SAM/BAM format specifications at <https://samtools.github.io/hts-specs/>.
