# V66 — Deterministic side-by-side managed VCF QC in Genithm AI chat

## User workflow

With the V64 managed-file scanner running, researchers upload and verify two to four actual VCF or VCF.gz files using Genithm's resumable, project-scoped Data workspace. They select the two to four **ready** VCF files inside Chat → Research files, then ask **"Compare these VCF QC reports"**.

V65's already reviewed private report fetch checks the whole-file source digest, report digest, owner, project, inspection, and exact metric schema. V48's Supabase function separately seals the selected file source and report hashes into the immutable user message. The server rejects mismatches before V66 can compare anything.

## Real algorithm, no language-model statistics

The small V66 deterministic comparator renders a Markdown table with one row per selected VCF in selector order. Every count comes from the V64 full-file scanner: site total, SNV, indel, symbolic, multi-allelic, PASS sites and PASS share, transitions/transversions, mean available QUAL, and sample-column count. Exact formulae:

- PASS percentage: 100 × PASS site count / total VCF site records. If zero records, percentage is *n/a*.
- Ti/Tv: canonical single-base alternative-allele transitions / transversions. With zero transversions the ratio is *n/a*, never infinity, and never falsely treated as a site-level ratio.
- Mean QUAL: mean numeric QUAL across sites with available QUAL; *n/a* if unavailable.
- No cross-source site concordance, same-variant testing, per-sample counts, genotype semantics, allele frequencies, external reference checks, variant calling, pathogenicity or clinical interpretation is calculated or implied.

The deterministic reply is saved using the normal authenticated `finish_ai_chat_turn` RPC and returned as a chat message. **No AI provider call is made for the handled comparison**, and no new scientific compute job or storage permissions are granted.

## Security

- Only the exact server-fetched, DB-snapshot-checked V65 VCF metrics are input. Never accept browser-derived report numbers, filenames or raw variant rows as scientific evidence.
- Compare exactly 2–4 distinct files, one project, with complete `full_vcf_site_qc` inspection. Byte-only, incomplete, legacy, forged, duplicate or mixed-project evidence cannot enter this path.
- The table identifies each file by list position and a 12-character prefix of the previously validated source SHA-256, not by filenames, patient identifiers, genomic coordinates or alleles.
- If the question is about overlapping/shared variants or genotype concordance, the reply explicitly states those conclusions cannot be established from aggregate QC statistics. It may display the QC table but never invent a variant comparison.
- Arbitrary images, local browser previews or other sequence attachments bypass the deterministic path; they do not silently override the user's intended task.
- Report hashes are integrity identifiers, not cryptographic signatures. Neither an SHA-256 hash nor a VCF site-QC report proves the biological findings are correct.

## Rollout

This code requires V64 scanner-capable managed storage to produce genuine new VCF site reports. V65 selects authorized report summaries. V66 runs **inside the existing signed-in Genithm chat**, without a new database table, secret, migration, compute provider, or brand change. Deployment still requires the separate operator-enabled, correctly configured large-file worker and object storage. The 100-GiB upload policy is not a scientific performance guarantee.

Verification:
`node --experimental-strip-types --test apps/web/tests/verified-vcf-comparison-v66.test.mjs`.
The dedicated CI also reruns the V48 and V65 file-evidence regressions. Full web/Next.js/other science checks run in the repository's standard GitHub workflows.
