# Genithm V61 — real BED/GFF3 overlap in authenticated AI chat

Attach **one BED** (3–12 tab-separated columns) and **one GFF3** (nine columns, declared `##gff-version 3`), optionally gzip-compressed. Ask: **Intersect my BED intervals with GFF3 features and calculate coverage**. Explicitly authorize temporary private processing. Genithm executes the deterministic interval-tree engine in a restricted Codespaces Node subprocess, not in the LLM.

Outputs: `interval-overlaps.tsv`, `coverage-by-feature.tsv`, `genomic-overlaps.svg`, `summary.json`, `provenance.json`, `METHODS.md`, and checksummed `complete-results.zip`. The output attaches to chat and downloads through the existing authenticated project/owner-scoped 48-hour endpoint.

**Correct coordinate rules:** BED is zero-based half-open, GFF3 is one-based inclusive. Each GFF3 row is counted separately; unioned base-pair overlap prevents double counting nested annotations and duplicate BED intervals. Chromosome names and reference assemblies must match exactly. No genome liftover, strand-aware interpretation, gene regulation inference or clinical analysis is claimed.

Safety: 8 MiB maximum per file, including decompressed gzip, up to 50,000 BED intervals, 50,000 GFF3 features and 100,000 reported intersections. Inputs require valid UTF-8, bounded numeric coordinates and valid structures. Results quote original source SHA-256 hashes but never copy private source rows into AI prompts. The original files are removed after processing. No Supabase schema change or new secret required.

Test with `node --experimental-strip-types --test scripts/tests/test_genomic_intervals_v61.mjs`. Full regression for V60, V59 and V58 still required. This new feature is not a replacement for whole-genome analysis or large-scale remote computation.
