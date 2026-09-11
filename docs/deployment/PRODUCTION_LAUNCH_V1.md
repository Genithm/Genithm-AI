# Genithm V1 Production Launch

This is the canonical launch sequence for V1. Where older deployment notes mention Vercel, this runbook supersedes them: the V1 web tier is Cloudflare Workers.

## Locked topology

Browser -> Cloudflare Workers web -> Cloudflare Tunnel API hostname -> Oracle API -> Supabase + R2 + six Oracle workers.

The approved deployment candidate is identified by its `v1-release.json`. Deploy only digest-pinned API/worker/cloudflared images from that bundle. Do not promote floating image tags.

## Required account-side resources

- Cloudflare zone/account with Workers, Tunnel, DNS, and private R2 bucket.
- Oracle Cloud VCN plus API and worker compute hosts created from the repository Terraform.
- Supabase production project already containing the approved V1 migrations.
- Production Qwen primary and DeepSeek backup credentials.
- Audit signing key material.
- NCBI contact email and optional API key.

Never commit real credentials. Runtime secrets remain on the target services/hosts.

## Cloudflare Workers web variables

Set all four production values before build/deploy:

```text
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
NEXT_PUBLIC_GENITHM_API_URL=https://<production-api-origin>
GENITHM_APP_URL=https://<web-domain>
```

The API URL must be HTTPS and must point to the public Cloudflare Tunnel hostname. A production build must not use localhost.

## Oracle deployment inputs

1. Download the approved V1 release artifact.
2. Extract `v1-release.json`.
3. Render immutable image variables:

```bash
python scripts/render_v1_deployment_env.py --bundle v1-release.json --output deployment-images.env
```

4. Copy only the relevant image lines into `deploy/oracle/.env.api` and `deploy/oracle/.env.workers` on the target hosts, together with runtime-only secrets.
5. Validate and deploy using the launch controller:

```bash
python scripts/production_launch.py workers --env-file deploy/oracle/.env.workers
python scripts/production_launch.py api --env-file deploy/oracle/.env.api
```

Workers are deployed first so API readiness can become green as soon as the API starts.

## Controlled rollback

Before every production promotion, retain the previously approved API and worker runtime env files, including their digest-pinned image references, in the protected operator environment. Do not store those runtime env files in Git.

If a deployment fails health, readiness, smoke, scientific validation, or causes material regression, rollback workers first and then the API to the previously approved digests:

```bash
python scripts/production_rollback.py workers \
  --env-file /secure/genithm/previous/.env.workers \
  --expected-source-sha <previous-approved-release-sha> \
  --evidence-out /secure/genithm/evidence/rollback-workers.txt

python scripts/production_rollback.py api \
  --env-file /secure/genithm/previous/.env.api \
  --expected-source-sha <previous-approved-release-sha> \
  --evidence-out /secure/genithm/evidence/rollback-api.txt
```

The rollback controller runs the same Oracle deployment preflight, requires immutable digest-pinned images, pulls the prior images, recreates the Compose services, and records secretless rollback evidence when requested. A rollback is not considered complete until `/health`, `/ready`, and production smoke have been re-run against the restored deployment.

Database migrations must remain backward-compatible for the rollback window. If a release includes an irreversible database change, that change requires a separately reviewed recovery procedure before production promotion.

## Cloudflare Tunnel

The remotely managed Tunnel public hostname forwards to `http://api:8000` inside the API Compose network. Do not expose Oracle TCP/8000 publicly. The tunnel token is backend-only.

## R2

Use a private bucket. Browser upload access is only through short-lived presigned URLs. Configure CORS for the production web origin and only the methods/headers needed by signed upload/download flows. Never expose R2 API credentials to the browser.

## Web deployment

From `apps/web`, with production build variables present:

```bash
npm ci
npm run cf:build
npm run cf:deploy
```

The release remains blocked if the compressed Worker exceeds the repository Free-plan size contract.

## Release gates

After all services are deployed:

```bash
python scripts/production_smoke.py --api-base-url https://<api-domain> --web-base-url https://<web-domain>
```

Then run the authenticated production scientific E2E harness from an authorized environment.

`v1.0.0` may be tagged only when all of the following are true:

- API health passes through Cloudflare.
- Web health passes on Cloudflare Workers.
- API readiness reports exactly 6 expected workers and 9 expected queues with zero missing/stale entries.
- R2 upload/validation/download flow passes.
- NCBI, BLAST, pairwise, MSA, phylogeny, protein, audit, and AI paths pass the release criteria.
- Qwen primary and DeepSeek fallback provenance are verified.
- Production smoke passes.
- Production scientific E2E passes.
- A controlled rollback drill has been executed against previously approved digest-pinned images and rollback evidence retained.
- Backup/recovery procedures have been checked, including integrity validation of restored critical data where the selected service tier supports restore testing.

## Final evidence manifest

Before creating the final `v1.0.0` tag, create a secretless evidence manifest from `release/v1/final-evidence.example.json`. It must reference the exact approved candidate source SHA and provide a non-empty evidence reference for every required live gate. Do not put credentials, tokens, private keys, scientific payloads, or user data in this file.

Validate it locally from the protected release environment:

```bash
python scripts/validate_v1_final_evidence.py \
  --evidence /secure/genithm/evidence/final-evidence.json \
  --expected-source-sha <approved-candidate-source-sha>
```

The validator requires all live checks to be true and readiness to report exactly 6/6 healthy workers and 9/9 healthy queues with no missing or stale entries. A failed validation blocks the final tag.

Until these live gates pass and the final evidence manifest validates, the build remains a deployment candidate, not a production release.
