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
- Rollback and backup/recovery procedures have been checked.

Until these live gates pass, the build remains a deployment candidate, not a production release.
