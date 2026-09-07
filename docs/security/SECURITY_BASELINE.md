# Genithm Security Baseline

## Principles

1. Default deny and least privilege.
2. Every exposed tenant table uses Row Level Security.
3. Authentication is not authorization: policies must bind access to ownership or membership.
4. Elevated Supabase keys are server-only and never committed.
5. AI components never receive unrestricted shell or database authority.
6. Scientific computation runs in controlled tools/workers and emits provenance.
7. Security-relevant changes are versioned and reviewed.

## Current controls

- Supabase Auth identity boundary.
- Forced RLS on workspace tables.
- Organization membership roles: owner, admin, member, viewer.
- Column-level update/insert grants where practical.
- Security-definer helper functions live in an unexposed `app_private` schema, use an empty search path, and have explicit EXECUTE grants.
- Atomic organization creation RPC prevents partial workspace creation.
- FastAPI security headers and explicit CORS allowlist.
- GitHub CI for frontend build and backend tests.
- Dependency update automation.

## Planned controls

- MFA/passkeys and session hardening.
- Upload quarantine, malware scanning, content validation, and size limits.
- Queue-isolated scientific workers with resource/time limits.
- Tamper-evident audit event chain and signed checkpoints.
- SAST/SCA/secret scanning and deployment policy gates.
