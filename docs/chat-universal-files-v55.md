# V55 — Universal research-file attachments in Genithm chat

## Repaired behavior

Previously, the chat paperclip accepted images and FASTA/text names but dispatched **every non-image file to a FASTA-only sequence validator**. A normal CSV/TSV, VCF, FASTQ or arbitrary document was rejected as "not FASTA" regardless of whether it was a useful scientific input.

V55 separates three trust and execution paths:

1. **Image** — validated JPEG/PNG/GIF/WebP is shared as a visual message to the Gemini model, using the existing image input path. Spoofed/unsupported image bytes never become valid images.
2. **FASTA** — actual FASTA content with an accepted sequence name uses the existing authenticated API reservation, upload, validation and project-scope checks. If the sequence service is unavailable (e.g. chat-only Codespace), the file is **not silently discarded**: Genithm falls back to an honest browser-local, **nonpersistent, unverified** preview. This does not make the file eligible for an authorized server job.
3. **Other research files** — the chat paperclip accepts any nonempty file name/extension, detects the format from bounded magic bytes and content, and inspects it in a dedicated browser worker without sending the raw file to a remote service. Users may ask Gemini/Groq about strictly bounded numeric aggregates. Proprietary, compressed and otherwise unsupported files are accepted as **opaque metadata**, not advertised as decoded or scientifically executed.

A separate, existing **Research files** panel provides real private, project-scoped, large-file and folder storage through the V47 universal verifier when the backing API, object store and workers are actually running. Its signed, server-verified V48 evidence path remains independent from the browser-local previews; a browser report never becomes a ready upload ID or a scientific job.

## Actual complete local analyzers

For files up to **8 MiB**, the browser may compute whole-file, format-specific aggregates:

| Format | Verified local measures | Caveats |
| --- | --- | --- |
| FASTA | Number of records and symbols, minimum and maximum sequence length | Alphabet/type and sample identity are not inferred |
| FASTQ (plain) | Four-line read count, base count, Q30 bases (Phred+33), GC bases, read lengths | Wrapped FASTQ and other encoding conventions are not silently accepted |
| VCF v4 (uncompressed) | Variant/SNV/indel/pass counts, biallelic count, sample count | Not variant calling, annotation, filtering decisions or GWAS |
| CSV/TSV | Strict table row/column count, missing cells, populated numeric columns | No biological semantics, participant interpretation or schema inference |
| BED | Interval count and total covered interval length (overlap not deduplicated) | Not deduplicated genome coverage or genome assembly alignment |
| GFF/GTF | Validated coordinate feature count | No gene model correctness assessment |
| SAM (plain) | Mapping/unmapping flag counts, alignment rows | Not CIGAR validation, mapping correctness or aligner equivalence |
| PDB | ATOM/HETATM count and MODEL count | No 3D geometry or molecular dynamics |
| JSON | Top-level key or array element count | Serialized content is treated as inert data; scripts never executed |
| Newick | Parsed outline leaf count | No phylogenetic inference or node branch significance |
| Plain text/code | Line and character counts | No automatic execution; excerpts need consent |

Full-file **SHA-256** is computed only for completely inspected files. It is a browser calculation, *not a server-attested digest*. Invalid structured files are accepted as **invalid local inspection**, without made-up biological metrics. Files **larger than 8 MiB** are detected from up to 64 KiB of header and labelled **header only** (text) or **opaque** (binary); Genithm does not misrepresent a partial count as a complete analysis.

Uncompressed binary formats and packages including BAM, CRAM, BCF, PDF, DOCX, XLSX, HDF5/H5AD, Parquet, compressed gzip/BGZF, RDS, mzML, POD5 and ZIP are accepted as metadata/header when their content cannot be safely and completely analyzed locally. Format recognition is not equivalent to the ability to run their full scientific pipelines. For large/unknown files, use the private Research files upload and the appropriate implemented analysis lab.

## User experience

- **Attach** in chat accepts any file without an extension-based picker restriction; supports multiselect and drag-and-drop (10 attachments total). Browser data never enter a FASTA endpoint unless its content is actually FASTA.
- File chips show whether **fully inspected**, **header-only**, **opaque** or **invalid**, with a local numeric results report available for supported formats.
- Only bounded metrics, classification, filename, size and full-file digest (when computed) go with the chat request; the original file's bytes are not uploaded to Gemini/Groq or Supabase by the local path. The user must explicitly check **Share up to 1,500 characters** to send a textual excerpt from a compatible text/table file.
- If the original full file is required to execute GWAS or a scientific job, the user must supply it to the corresponding real scientific tool or working private storage workflow. Local previews are ephemeral and cannot be replayed after reloading the chat.
- The chat server rejects malformed, oversized or fabricated-looking local evidence fields before any database writes. It treats **all browser-provided counts as untrusted**, never assigns them a database file ID and disables model scientific-function proposals on local-file turns. GWAS dispatch, sequence validation, ownership checks and the V48 verified-file RPC remain independent.
- The report does **not** assert malware detection, clinical validity, provenance of participants or other unsupported guarantees.

## Verify

Run from repository root:

```bash
node --experimental-strip-types --test apps/web/tests/chat-file-intake-v55.test.mjs apps/web/tests/chat-file-composer-v55.test.mjs
```

Existing repository CI continues to enforce TypeScript, production Next build, bioinformatics validation, authenticated scientific approval contracts and security policies. Test V55 with an actual authenticated Codespace by attaching `my_study.csv` (no FASTA error), a small VCF, a genuine FASTA, an opaque binary, and a large compressed dataset; then verify in-browser status and explicit sharing consent. The private full scientific worker fleet must be started separately for server-side sequence execution.

## Longer-term scientific breadth

The goal is a broad AI-first research platform, not a fixed set of FASTA operations. V55 repairs the universal chat intake and gives honest inspection on common file families; it **does not implement every possible bioinformatics method**. Larger GWAS (PLINK2/SAIGE/REGENIE), single-cell H5AD processing, BAM/CRAM alignment workflows, RNA-seq and mass-spectrometry pipelines need dedicated validated engines, consent, sandboxed compute, resource quotas and result provenance before Genithm can claim scientific execution for them.
