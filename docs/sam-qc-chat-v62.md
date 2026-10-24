# Genithm V62 — real SAM alignment quality control in the AI conversation

## What a researcher does
In **Genithm AI**, attach one valid `.sam` or `.sam.gz` file to an active research project and ask:

> Analyze mapping quality, CIGAR operations and reference coverage in this SAM alignment file, with downloadable results.

The user must explicitly approve temporary private Codespaces computation. This engine runs real verified scientific code **before** an LLM response; SAM read names, bases and alignment lines are never passed into Gemini/Groq. The original SAM file is deleted from the worker input directory after processing. This is not available on Cloudflare edge or an unconfigured hosted deployment.

## Real calculations
- Full text record scan with validated mandatory 11 SAM columns, finite integers, CIGAR query/reference consumption, paired flags, MAPQ and declared @SQ reference boundaries.
- Separate counts of alignment records, primary mapped/unmapped, secondary, supplementary, flagged duplicates, QC failures, first/last segments, proper paired records and reverse strands.
- CIGAR M/= /X, I, D, N, S, H and P summed over primary mapped records. Reference coverages are **unions of only M/=/X blocks**, excluding D and N, so duplicate/nested alignments do not inflate covered base pairs.
- Per-reference declared length, primary mapped alignment counts, aligned base totals, unioned base coverage/fraction, and mean available MAPQ.
- MAPQ 255 is **unknown**, never included in mean mapped quality. NM:i tagged edit counts are optional and are not an independently established sequencing error rate.
- Only pre-existing alignments are inspected: Genithm does **not** run read mapping, detect novel variants, compare to a reference sequence, infer contamination or prove clinical significance in this workflow.

## Downloads
The existing authenticated, project-scoped, SHA-256 verified 48-hour science results download endpoint serves:
- `sam-mapping-qc.tsv` — overall counts and summary
- `sam-reference-coverage.tsv` — measured per-reference covered base pairs and mapping metrics
- `sam-cigar-operations.tsv` — primary-alignment CIGAR operation totals
- `sam-mapq.svg` — MAPQ distribution
- `summary.json`, `provenance.json`, `METHODS.md`, and `complete-results.zip` — method, original-source SHA-256, limitations and complete archive

## Input, resource and security constraints
- Only text SAM or gzip-compressed text SAM; binary BAM/CRAM cannot be decoded by this engine. Detect magic bytes, reject invalid UTF-8 and disallow invalid SAM input.
- Maximum source file **12 MiB compressed and 12 MiB decompressed**. At most **120,000** alignment records, **2,000** references, **250,000** coverage blocks, and **1.5 million** CIGAR operations. No entire reference genome is loaded.
- Mapping records without an @SQ reference or with out-of-bounds coordinates are rejected. The worker has a 150-second execution deadline and never receives AI-provider/database secrets.
- TSV exports escape potentially executable spreadsheet formulas; SVG contains only approved static markup and escaped labels. Summary and provenance do not include QNAMEs, individual read sequences or file contents.
- Feature remains limited to consented, owner/project-bound private Codespaces computation, not a production-distributed or multi-GB sequence executor. Existing V58-V61 48-hour result links remain supported.

## Testing
`node --experimental-strip-types --test scripts/tests/test_sam_qc_v62.mjs`

The suite checks real CIGAR coverage and MAPQ calculations, paired and secondary alignment counting, gzip, malformed references/qualities/flags/records, source hashes, spreadsheet safety, large sparse fixtures, chat consent/routing, manifest hashes and end-to-end zip export in the actual isolated CLI. V61, V60 and V59 regression suites are also run in CI.

No new Supabase table, migration, secret, external API or visual rebranding is introduced.