# Genithm Railway V1 deployment map

## Services

Create these services from the monorepo with the listed root directories:

- Web: `apps/web`
- API: `apps/api`
- sequence-worker: `apps/sequence-worker`
- source-worker: `apps/source-worker`
- blast-worker: `apps/blast-worker`
- scientific-worker: `apps/scientific-worker`
- audit-worker: `apps/audit-worker`
- ai-worker: `apps/ai-worker`

## Public services

Only Web and API expose HTTP endpoints.

API health:

`/api/v1/health`

API readiness:

`/api/v1/ready`

Web health:

`/api/health`

## Secrets

Never commit these values.

API and workers:

- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`

Workers:

- `NCBI_EMAIL`
- `NCBI_API_KEY` (optional)
- `OPENAI_API_KEY`
- `GENITHM_AI_MODEL`
- `GENITHM_AUDIT_SIGNING_KEY_ID`
- `GENITHM_AUDIT_SIGNING_PRIVATE_KEY_BASE64`

## Release verification

After all six workers are running, verify:

1. API readiness returns `status=ready`.
2. Supabase readiness reports no missing workers.
3. Run one controlled scientific workflow.
4. Run production smoke checks.
