# Genithm V70 — real transcript-level Salmon quant.sf import

## Scientific scope

This release adds an actual, browser-local parser and matrix assembler for
published Salmon quantification result format quant.sf. It **does not run
Salmon**, map reads, infer gene-level raw counts, perform reference mapping or
run differential expression. It imports already-existing researcher-supplied
quantification outputs, validates their numerical integrity, matches transcript
IDs across samples and exports measured transcript-level matrices.

Each input requires exactly the five Salmon quant.sf columns:
Name, Length, EffectiveLength, TPM, NumReads. Every transcript ID, reported
effective length, TPM and NumReads is read from the selected file. Sample IDs
are assigned by the researcher; they are not inferred from private input.
Each file has up to 100,000 transcript entries and 24 MiB of text. At most
24 samples and 1,000,000 transcript-by-sample matrix cells can be processed
per invocation. Invalid TSV, reused identifiers, nonfinite values, negative
abundance or inconsistent transcript IDs/reference transcript lengths fail
closed. Nonzero abundance must have a TPM sum close to one million, allowing
a narrow rounding margin.

Actual scientific outputs:
- transcript-level TPM matrix joined by transcript identifier
- transcript-level Salmon NumReads estimated-fragment matrix
- per-sample transcript/expressed-transcript totals, estimated-fragment
  sums, summed TPM and effective-length-zero statistics
- explicit limitations stating source FASTQ and reference/index are unverified

The input and result bytes stay entirely inside the signed-in Genithm
browser session until explicitly downloaded. Nothing is posted to the
language model, Supabase or private compute worker. No SQL schema, key,
cloud host, bandwidth allocation or project quota is changed.

## Important scientific restrictions

Salmon NumReads may be fractional and are **estimated transcript fragment
abundances**, not raw integer gene counts. The existing Genithm browser
Expression Lab expects genuine raw integer gene counts and must not accept
this matrix as if a transcript-to-gene tximport/DESeq2 workflow had run.
Matching Name and Length across Salmon files is a necessary sanity check,
NOT independent reference or transcriptome identity verification. The user
must independently establish the matching Salmon index/reference assembly.

This is a scientifically meaningful additional P1 import stage, NOT a
completed FASTQ -> Salmon -> DESeq2 pipeline or an automatically executed
nf-core workflow. The general delivery plan is recorded in
docs/universal-bioinformatics-delivery-plan-v69.md.

## Verification and future work

Run local Node tests for actual TPM/estimated counts and falsified inputs.
The dedicated workflow tests the V69 metadata intake and V56 expression
engines for compatibility. Next steps: record original input hashes,
validate reference transcriptome and index identity, admit genuine managed
FASTQ bytes, run pinned nf-core/rnaseq and validate gene-level tximport
before applying an appropriately modeled differential-expression tool.

Salmon documentation: https://combine-lab.github.io/salmon/getting-started/quick-start/
