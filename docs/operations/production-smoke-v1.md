# Production smoke V1

Genithm's production smoke gate is a secretless, read-only post-deploy validation layer. It verifies the deployed API surface and its server-side release-readiness dependency check without directly handling Supabase credentials or scientific payloads.

## What it validates

The smoke runner checks:

1. `GET /api/v1/health`
   - HTTP 200
   - exact process identity: `{ "status": "ok", "service": "genithm-api" }`
   - required API security headers are present
2. `GET /api/v1/ready`
   - HTTP 200
   - `status=ready`
   - the deployed API therefore successfully completed its backend-only Supabase queue readiness check
3. Optional deployed web origin
   - HTTP response is reachable with a 2xx or 3xx status

The runner does not send API keys, user sessions, FASTA content, prompts, evidence, results, storage paths, or queue payloads.

## Failure behavior

The smoke gate fails closed when:

- the API cannot be reached within the bounded retry window;
- health identity is unexpected;
- required security headers are missing;
- readiness returns HTTP 503 or any non-ready state;
- the optional web target is unreachable; or
- a production target is not HTTPS.

The readiness endpoint remains responsible for checking the expected PGMQ queues and stale backlog. The smoke runner only verifies that the deployed service can successfully exercise that contract.

## GitHub workflow

`.github/workflows/production-smoke.yml` is manually dispatched after deployment. It accepts the deployed API HTTPS origin and an optional web HTTPS origin as workflow inputs.

The workflow is intentionally secretless:

- no GitHub secrets are referenced;
- no Supabase key is supplied to GitHub Actions;
- repository permissions are read-only;
- third-party actions are pinned to full commit SHAs.

This preserves the repository security policy while still providing a repeatable production release gate.

## Local/operator usage

Production target:

```bash
python scripts/production_smoke.py --api-base-url https://api.example.com
```

With a web target:

```bash
python scripts/production_smoke.py \
  --api-base-url https://api.example.com \
  --web-base-url https://app.example.com
```

`--allow-http` exists only for local/non-production testing.

## Current E2E boundary

This smoke gate proves deployed edge/API readiness. It does **not** claim that a full scientific job completed end-to-end.

A true Genithm scientific E2E gate requires continuously deployed workers for sequence validation, NCBI retrieval, BLAST, scientific jobs, protein annotation, audit checkpoint signing, and AI processing. Until those runtimes are continuously deployed, an accepted queued request must not be reported as proof of automatic production execution.

The next production validation layer should add a dedicated synthetic test tenant and disposable scientific fixtures after the worker deployment model is established. Synthetic E2E data must remain isolated from real user projects and must be cleaned up through explicit, audited test-only operations.