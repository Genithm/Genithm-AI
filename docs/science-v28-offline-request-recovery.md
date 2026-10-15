# Science V28 — Honest offline research and manual recovery

## Problem

V27 correctly prevents any new fixed NCBI research approval when the six continuous workers are offline. However, a direct text-only NCBI request previously fell through to the general LLM stream when `GENITHM_SCIENCE_V22_ENABLED` was unset, a schema check failed, or worker health was unavailable. A model-generated conversational answer could appear to be a scientific calculation even though **no NCBI retrieval or science job had run**.

On 15 October 2026, all V22–V26 database migrations were installed in the existing Genithm Supabase project; its `get_release_readiness()` remained `not_ready` with six stale worker heartbeats. Neither Cloudflare runtime access nor Oracle worker host access is currently connected here.

## User journey

1. A user submits a direct **single-reference** request for one of the two fixed research protocols in normal AI chat. Requests with uploads, images, ambiguous/multiple accessions, negations or scripting instructions **do not** enter this fixed-protocol classification.
2. The saved user's message remains under the existing owner/project/organization scope.
3. When the **feature flag is disabled**, the V22 projection fails, or worker/queue readiness is not verified, Genithm records a **deterministic text-only availability notice** rather than invoking the LLM to invent findings. The SSE event reports `status=research_unavailable` and `requires_confirmation=false`. No scientific job, run, consent marker, or queue entry is created.
4. When configured, schema-ready and workers are online, V27's service-role readiness gate and trusted media attestation still control the normal **explicit approval** proposal. Human approval remains mandatory and checked again at submit time. V22's atomic RPC remains authoritative.
5. When services recover, the conversation refreshes every **30 seconds only while visible and previously offline**. The authenticated conversation may offer the latest historic *unattested* eligible text-only direct NCBI request as a **composer suggestion**. Clicking merely copies text into the composer; it never submits, updates the old message, authorizes science, or starts a job.
6. The researcher must **send a new message** and then **Approve** the resulting protocol. Old messages must never be retrospectively sealed: media that appeared in a previous browser turn might not be in the stored attachment IDs.

## Verification

The new `apps/web/tests/offline-science-recovery-v28.test.mjs` verifies both fixed NCBI templates, invalid/ambiguous requests, truthful non-results, saved completion rather than provider dispatch, no approval/queueing, safe replay selection, visible-tab-only refresh, and explicit fresh consent. Existing V20–V27 scientific and web build suites remain required.

This change does not create a new Supabase project or migration. It does **not** start offline Oracle workers or set Cloudflare environment variables, and does not claim live NCBI/scientific E2E passed. Use issue #210 and the Oracle deployment runbook to restore worker availability.
