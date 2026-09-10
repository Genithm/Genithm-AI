# Genithm V1 — Oracle Cloud deployment

This runbook implements the V1 infrastructure direction documented for Genithm: Vercel/Next.js for the frontend, Oracle Cloud for API/compute and long-running scientific workers, Supabase for PostgreSQL/Auth, and Cloudflare R2 for large scientific objects.

## V1 topology

Use two Oracle compute roles rather than putting every responsibility on one VM:

- API host: lightweight public VM. The Genithm FastAPI service is the only application service that should receive inbound Internet traffic.
- Worker host: Ampere A1 ARM64 VM for the six continuously running queue consumers. Workers require outbound HTTPS but no inbound application ports.

The worker release pipeline publishes multi-architecture linux/amd64 + linux/arm64 images so the same immutable release can run on Oracle Ampere A1 and conventional AMD64 hosts.

## Network boundary

- Put the API host behind the public ingress layer and expose only HTTPS plus restricted administrative SSH as required.
- Do not expose worker container ports. The worker host needs outbound DNS and HTTPS for Supabase, NCBI, AI providers, registry pulls, and approved object-storage endpoints.
- Restrict SSH to an administrative source range or private access path. Do not expose database ports because PostgreSQL/Auth remain managed by Supabase.
- Use Oracle VCN security lists/network security groups as an outer boundary in addition to host firewall rules.

## Worker secrets

Create `deploy/oracle/.env.workers` on the worker host from `.env.workers.example`. The real file must never be committed.

Required runtime values:

- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`
- `NCBI_EMAIL`
- `OPENAI_API_KEY` until the locked Qwen-primary / DeepSeek-backup provider migration is completed
- `GENITHM_AI_MODEL`
- `GENITHM_AUDIT_SIGNING_KEY_ID`
- `GENITHM_AUDIT_SIGNING_PRIVATE_KEY_BASE64`

Optional:

- `NCBI_API_KEY`

The Supabase secret/service credential is backend-only. Never copy it into Next.js `NEXT_PUBLIC_*` variables or any browser bundle.

## Immutable worker deployment

Use only the six digest-pinned references from a successful Worker release artifact for the exact tested main commit. Do not deploy `latest` tags or hand-built local images.

On the worker host, place the release references in `.env.workers`, then validate the Compose file before starting anything:

```bash
docker compose --env-file deploy/oracle/.env.workers -f deploy/oracle/docker-compose.workers.yml config
```

Pull all immutable images:

```bash
docker compose --env-file deploy/oracle/.env.workers -f deploy/oracle/docker-compose.workers.yml pull
```

Start or replace the worker set:

```bash
docker compose --env-file deploy/oracle/.env.workers -f deploy/oracle/docker-compose.workers.yml up -d --remove-orphans
```

Inspect process state:

```bash
docker compose --env-file deploy/oracle/.env.workers -f deploy/oracle/docker-compose.workers.yml ps
```

All six services must remain running:

- `sequence-worker`
- `source-worker`
- `blast-worker`
- `scientific-worker`
- `audit-worker`
- `ai-worker`

## Release readiness gate

Workers report heartbeats through the existing Genithm operational contract. Do not declare the release ready merely because containers are running.

The public API readiness endpoint must ultimately return HTTP 200 with `status=ready`, with no missing or stale workers/queues. Before the workers are deployed the expected state is `not_ready` with the six workers listed as missing.

After deployment:

1. confirm all six Compose services are running;
2. confirm worker logs show successful startup and heartbeat publication;
3. confirm Supabase `get_release_readiness()` reports zero missing/stale workers;
4. confirm `/api/v1/health` returns 200;
5. confirm `/api/v1/ready` returns 200 and `status=ready`;
6. only then run a controlled real-user scientific workflow.

## Rollback

Rollback is image-reference based. Keep the previous successful worker release artifact. Replace the six digest references in `.env.workers` with the previous release's immutable references, then run `docker compose pull` followed by `docker compose up -d --remove-orphans`.

Do not purge Supabase queues during rollback. Existing visibility timeouts and bounded retry/finalization semantics are designed so queued work can recover after a worker replacement.

## V1 deployment order

1. Merge and release the multi-architecture worker pipeline.
2. Create Oracle networking and the API/worker compute hosts.
3. Harden the hosts and install Docker/Compose using Oracle-supported packages/instructions.
4. Deploy the six worker images from one successful release artifact.
5. Deploy the Genithm API with backend-only Supabase credentials and allowed frontend origins.
6. Configure the Next.js frontend on Vercel with only public Supabase browser credentials and the production API origin.
7. Integrate Cloudflare R2 for large uploads/results before enabling large-file production workflows.
8. Align the AI runtime with the documented Qwen-primary / DeepSeek-backup provider strategy.
9. Run end-to-end production validation and only then tag V1.

## Kubernetes boundary

The repository retains a Kubernetes worker template for later scaling. V1 Oracle launch does not require Kubernetes. The Docker images, environment contract, queue semantics, readiness checks, and immutable release discipline are intentionally portable so a later Kubernetes migration does not require rewriting scientific worker code.
