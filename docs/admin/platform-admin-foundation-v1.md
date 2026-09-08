# Platform Admin Foundation V1

Platform Admin V1 establishes Genithm's internal SaaS control-plane boundary without granting administrators unrestricted access to customer scientific content.

## Access model

Platform-admin entitlement lives in `app_private.platform_admins` and is keyed by the authenticated Supabase user UUID.

The browser cannot insert, update, delete, or directly select this registry. There is no public RPC to grant or revoke platform-admin access. Entitlements must be managed through an authorized database/operator process outside the customer browser surface.

Authorization never relies on `raw_user_meta_data`, profile fields, organization roles, or other user-editable metadata.

## Public admin RPC surface

Authenticated users can call three bounded RPCs:

- `is_platform_admin()` — returns whether the current authenticated user has the operator-managed entitlement.
- `get_platform_admin_overview()` — returns aggregate platform counts, bounded status distributions, audit-event count, and worker heartbeat freshness.
- `get_platform_admin_organizations(page_size, page_offset)` — returns at most 100 organization summaries per call with organization name/slug and aggregate member/project counts.

The aggregate RPCs fail with `42501` unless `is_platform_admin()` is true.

## Intentionally excluded in V1

The admin surface does **not** return:

- user email addresses or authentication credentials;
- member identities;
- uploaded FASTA/sequence contents;
- NCBI source bodies;
- BLAST XML/results or normalized hit payloads;
- scientific result bodies;
- AI prompts, plans, interpretations, evidence snapshots, or follow-up answers;
- report snapshots;
- object-storage paths;
- API keys, signing keys, service credentials, or secret values.

V1 also contains no destructive actions, user suspension, organization deletion, membership mutation, subscription mutation, or scientific-job retry controls.

## Dashboard

`/dashboard/admin` is server-rendered and requires an authenticated platform-admin entitlement. Non-admin requests resolve as not found rather than returning admin data.

The normal dashboard navigation only shows the Platform admin link when the entitlement RPC returns true.

## Next admin slices

Future admin capabilities should be added as narrowly scoped audited actions rather than broad table access. Candidate follow-ups include user/org support lookup, subscription/entitlement management, usage metering, suspension controls, and operational retry tooling. Each mutation should use explicit authorization, reason fields, bounded inputs, and audit events.
