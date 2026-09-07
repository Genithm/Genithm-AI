# Genithm Architecture

Genithm separates reasoning from authority and execution:

`AI plan -> policy authorization -> scientific tool/worker -> evidence/provenance -> verification -> explanation`

## Application layers

- `apps/web`: user experience, Supabase Auth session handling, workspace UI.
- `apps/api`: service boundary for health/readiness and future orchestration endpoints.
- `supabase`: identity-linked application state, tenant isolation, policies, migrations.
- Future worker services: deterministic scientific tools such as sequence validation, BLAST, alignments, and related pipelines.

The API layer must not become an unrestricted scientific shell. Long-running or resource-heavy jobs will be queued and executed by isolated workers.
