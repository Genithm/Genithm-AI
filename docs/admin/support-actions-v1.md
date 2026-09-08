# Genithm Admin Support Actions V1

## Purpose

Support Actions V1 extends the read-only Platform Admin foundation with a narrowly bounded support workflow. It is not a general superuser console.

## Authorization

- Platform-admin entitlement is stored in `app_private.platform_admins` and is never derived from user-editable metadata.
- Read-only exact-account lookup and support-case reads require an authenticated platform admin.
- Support-case create and resolve operations additionally require an `aal2` Supabase session.
- The AAL2 requirement is enforced inside the privileged database function, not only in the UI.
- Public RPC wrappers are `SECURITY INVOKER`; privileged helpers stay in `app_private`, use `SECURITY DEFINER`, and set an empty `search_path`.
- No service/secret key is used in the browser.

## Account lookup

The admin console accepts one exact email address and returns only the matching account, if one exists. There is deliberately no fuzzy search, prefix search, enumeration endpoint, or bulk user listing.

Returned support fields are limited to:

- user UUID
- exact email
- display name
- account creation time
- last sign-in time
- email confirmation time
- aggregate organization/project counts
- bounded organization memberships

Passwords, password hashes, refresh tokens, identities/provider tokens, MFA secrets, raw user metadata, scientific data, AI prompts/evidence, storage paths, and billing instruments are never returned.

## Support cases

Support cases are private organization-scoped metadata records with:

- category
- title
- initial support note
- optional target user (must already belong to the organization)
- optional target project (must already belong to the organization)
- open/resolved state
- operator IDs and timestamps
- resolution note

V1 support actions do **not**:

- suspend or delete users
- change passwords or sessions
- impersonate users
- add/remove organization members
- change organization roles
- modify scientific jobs/results
- retry workers/jobs
- change subscriptions, entitlements, invoices, or payment state

## Audit trail

Creating and resolving support cases uses the existing Genithm append-only SHA-256 audit chain via `app_private.append_audit_event`.

Events:

- `PLATFORM_SUPPORT_CASE_CREATED`
- `PLATFORM_SUPPORT_CASE_RESOLVED`

Audit metadata contains bounded identifiers/category only; support note text is not copied into audit metadata.

## Data API boundary

`app_private.platform_support_cases` has forced RLS, an explicit restrictive deny-all policy, and zero direct grants to `anon`, `authenticated`, or `service_role`. Access is only through narrowly scoped RPCs.
