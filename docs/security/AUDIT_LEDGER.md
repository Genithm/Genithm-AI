# Tamper-evident audit ledger and scientific abuse controls

Genithm records security- and science-relevant lifecycle events for sequence inputs, NCBI retrievals, and BLAST jobs in an append-only audit ledger.

## Audit ledger

`public.audit_events` is readable only by authenticated members of the owning organization. Direct INSERT, UPDATE, and DELETE privileges are not granted to application roles. Ledger writes are performed only by database-owned trigger functions in `app_private`.

Each organization has an independent SHA-256 chain. Every event contains:

- organization and optional project context
- actor user when attributable and actor type (`user`, `service`, or `system`)
- event and resource type
- resource identifier
- outcome and bounded JSON metadata
- server timestamp
- chain sequence
- previous event hash
- current event hash
- chain format version

The current chain head is held in `app_private.audit_chain_heads`, which is not exposed to application roles. Per-organization row locking serializes ledger appends so concurrent events cannot reuse a chain sequence.

`public.verify_audit_chain(organization_id)` is available to authenticated organization members. It recomputes every event hash and verifies sequence continuity and the private chain head.

The ledger is **tamper-evident**, not an external immutable timestamp authority. A sufficiently privileged database administrator can still alter database state. Future production hardening can periodically sign/checkpoint chain heads and export them to immutable/WORM storage or an independent trust domain.

Audit metadata must never contain passwords, session tokens, API keys, Supabase secret/service keys, NCBI API keys, or raw biological sequence data.

## Scientific request limits

Expensive scientific entry points enforce server-side user and organization limits before accepting new work.

Current V1 policies:

| Action | User window | Organization window | Active user cap | Active organization cap |
| --- | ---: | ---: | ---: | ---: |
| NCBI retrieval | 30 / 5 min | 120 / 5 min | 5 | 25 |
| BLAST analysis | 10 / hour | 50 / hour | 3 | 12 |

Rate-limit state and policies live in `app_private`; clients cannot modify them. Limits are enforced in the authoritative request RPCs, not in the browser UI, so bypassing frontend controls does not bypass compute protection.

These limits are initial safety defaults rather than commercial quotas. They should become plan-/organization-aware as billing and enterprise policy layers are introduced.
