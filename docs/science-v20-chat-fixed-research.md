# Science V20 - fixed, explicitly approved multi-step research in chat

## User research experience

A researcher writes a clear request in Genithm chat, for example:

- "Retrieve NM_000546.6 and run an ORF scan"
- "Calculate protein properties for NP_000537.3"

The application recognizes only an **unambiguous single RefSeq accession** and one of the two audited, pre-existing pipeline templates:

1. `ncbi_nucleotide_orf_v1`: NCBI nucleotide -> FASTA validation -> ORF scan (minimum 30 amino acids).
2. `ncbi_protein_profile_v1`: NCBI protein -> FASTA validation -> protein properties.

The assistant gives a deterministic proposal and explicitly says **nothing has started**. The approval form is shown in the same chat. After the user approves, the server **re-reads the original stored user message**, verifies that conversation and message belong to the active authenticated account, independently re-parses the template and accession, and calls the existing authenticated database function for that exact template. Browser-provided IDs act as locators, never source-of-truth authorization; the client cannot choose a hidden compute tool or accession.

The existing `research_pipeline_runs` and actor-bound RPCs own deduplication, permission checks, source/validation job lineage, scientific inputs, cancellation/failure status, compute limits and terminal scientific result integrity. No generic scheduler, custom script execution, arbitrary queue insertion, or new RLS policy was added.

## Returning output to chat

The approval redirects back to the same conversation with the **specific user-owned run ID** in a URL parameter. The chat resolves the pipeline row under Supabase RLS plus project and user filters; its child retrieval, validation and scientific statuses are displayed as a three-stage progress timeline. Recorded scientific summary values are projected through Science V17's explicit allowlist. The existing authenticated, checksum-verified download route serves completed scientific output; no direct storage URL or secret object path is exposed.

Unrelated research runs in the same project are not conflated. The run is reachable after refresh/bookmark through the URL; durable many-to-one run-to-conversation linking across arbitrary chat history is a later schema-backed milestone.

## Safety and limits

- This is **not** unrestricted AI-generated multi-step execution.
- Natural-language classification is deliberately strict. It does not guess missing accessions, mix nucleotide with protein, handle multiple accessions or arbitrary scripts. Unsupported or ambiguous prompts continue through normal chat.
- A valid plan is **not** an authorization grant. Only clicking the button starts the fixed RPC.
- Only messages **without attached sequence files** can take this NCBI-only path, so the assistant does not disregard user-provided analysis data.
- Successful/failed/pending records are read from authoritative databases; no made-up scientific results.
- The existing audited pipeline migrations must already be installed for the feature to execute. If unavailable, the same chat shows a safe error and nothing is changed.
- **No live Supabase writes, migrations, worker deployments or production changes** are part of this code change.
- The associated proposal is not a stored AI plan. It is a deterministic UI opportunity derived from the stored user message, and the approval is an explicit independently authenticated server action.

## Verification

Run: `cd apps/web && node --experimental-strip-types --test tests/chat-fixed-research-protocol-v20.test.mjs`

The new suite covers positive/negative intent matching, multiple/mixed RefSeq accessions, no implicit compute, no hidden client-supplied accession or template, owner/project scoped backend calls, consent, step state, verified scientific output and fallback when pipelines are unavailable.

CI runs alongside Science V17/V19 regression tests, TypeScript, Next.js, Cloudflare and the existing backend and worker-image security checks.
