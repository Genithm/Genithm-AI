# Science V30 — Portable research-evidence bundles and independent metadata integrity

## Why

The V19/V23/V25 research dossier already presents an RLS-scoped, bounded summary of recorded scientific analyses, including fixed NCBI source → FASTA → scientific-input lineage and recorded result fingerprints. Users could previously export JSON and Markdown, but neither export included a portable integrity fingerprint or a repeatable local verification workflow.

V30 adds a **third export** that produces a strictly projected, versioned JSON evidence bundle with a SHA-256 digest of canonical metadata and a network-free verifier. It is built from the **existing authenticated conversation dossier** and does not expand data retrieval privileges, expose source sequences, access underlying storage, or bypass row-level security.

## Researcher workflow

1. Sign in, open an owned research conversation, and inspect its existing research dossier. The server applies the normal `ai_conversations` owner check, RLS, project-scoped scientific job lookup, and fixed-protocol source lineage checks before constructing the dossier.
2. Choose **Export SHA-256 evidence bundle**. The browser projects allowlisted fields, validates the dossier, serializes the payload in a reproducible sorted-key JSON form, calculates SHA-256 with Web Crypto, and internally verifies the generated package **before downloading**.
3. Save the reported `payload_sha256` independently of the bundle (e.g. in a trusted research notebook). Without an independently recorded digest, a corrupted bundle might be detected, but an attacker who can replace both the payload and its hash can forge the result.
4. Later verify it with the offline tool:

```bash
node --experimental-strip-types scripts/verify_science_evidence_bundle.mjs \
  path/to/genithm-evidence-<conversation-uuid>.json \
  <previously-recorded-payload-sha256>
```

The verifier checks the package schema, strict field and shape allowlist, payload checksum, known statuses and UUIDs, reproducible canonical bytes, and the recorded SHA passed separately. It reads **no more than 2 MB**, makes no network or Supabase requests, does not start jobs and does not print sensitive payloads to logs. It exits nonzero on tampering or malformed input.

## Export schema

- `format`: `genithm-science-evidence/1`
- `payload.exported_at`: ISO-8601 UTC timestamp
- `payload.dossier`: exact projected dossier version, conversation locator, recorded overall status, bounded counts, allowlisted findings/metrics/result hashes and validated **relative authenticated download links**, scientific steps, and caveats
- `payload.limitation`: an immutable explanation of which guarantees the bundle does **not** provide
- `integrity.algorithm`: `SHA-256`
- `integrity.payload_sha256`: lowercase SHA-256 of canonical `payload` bytes

The projector drops arbitrary DB fields rather than serializing raw rows. It refuses unknown metric labels, unexpected nested properties, forged scientific success states, invalid hashes, malformed UUIDs, unscoped/external download URLs, corrupt counts, unbounded data and malformed timestamps. The `source` field distinguishes regular AI-dispatched analyses from fixed NCBI pipelines.

## Explicit limits

- A SHA-256 digest here provides **payload consistency and tamper detection relative to an independently retained known-good digest**, not a digital signature, timestamp authority, identity assertion or proof that Genithm generated the file.
- The digest **does not verify underlying artifact bytes**. Those bytes must be fetched separately through Genithm's authenticated, checksum-enforcing scientific-job download endpoint.
- A recorded `completed` workflow remains a **recorded computational result**, not a claim of experimentally validated biology. Incomplete/unknown/failed findings stay incomplete/unknown/failed in exports, with no invented measurements or promoted evidence.
- A user can export only dossiers already visible through the application's ordinary authentication, Supabase RLS and original owner-scoped conversation queries.
- The bundle contains no raw FASTA sequences, private object storage paths, queue bodies, API keys, source response bodies, AI prompts or unreviewed result-summary fields.
- Export functionality works even if continuous Oracle scientific workers are offline: it covers existing **recorded** results, not new compute.

## Quality gates

`apps/web/tests/science-evidence-bundle-v30.test.mjs` verifies canonical stability, SHA-256 reproducibility, JSON reserialization, positive and negative status paths, checksum corruption, rehashed schema violations, unknown private fields, payload redaction, and the real offline CLI roundtrip. The existing V19–V29 dossier, consent, security, web build and Cloudflare compatibility CI remain required.

There is **no new Supabase migration**, no additional Supabase project, no change to authorization roles, no activation of `GENITHM_SCIENCE_V22_ENABLED`, and no live scientific work.
