# Genithm V1 — Oracle Cloud deployment

This runbook implements the V1 infrastructure direction documented for Genithm: Vercel/Next.js for the frontend, Oracle Cloud for API/compute and long-running scientific workers, Supabase for PostgreSQL/Auth, and Cloudflare R2 for large scientific objects.

## V1 topology

Use two Oracle compute roles rather than putting every responsibility on one VM:

- API host: lightweight public VM. The Genithm FastAPI service is the only application service that should receive inbound Internet traffic.
- Worker host: Ampere A1 ARM64 VM for the six continuously running queue consumers. Workers require outbound HTTPS but no inbound application ports.

The API and worker release pipelines are multi-architecture so the same immutable deployment can run on Oracle ARM64 or conventional AMD64 hosts.

## Network boundary

- Put the API host behind the public ingress layer and expose only HTTPS plus restricted administrative SSH as required.
- Bind the API container to host loopback only; terminate public HTTPS at the host reverse proxy or approved ingress layer.
- Do not expose worker container ports. The worker host needs outbound DNS and HTTPS for Supabase, NCBI, AI providers, registry pulls, and approved object-storage endpoints.
- Restrict SSH to an administrative source range or private access path. Do not expose database ports because PostgreSQL/Auth remain managed by Supabase.
- Use Oracle VCN security lists/network security groups as an outer boundary in addition to host firewall rules.

## API secrets

Create `deploy/oracle/.env.api` on the API host from `.env.api.example`. The real file must never be committed.

Required runtime values:

- `GENITHM_API_IMAGE` — digest-pinned API image reference
- `GENITHM_API_ALLOWED_ORIGINS` — production frontend origin(s)
- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`

The Supabase secret/service credential is backend-only. Never copy it into Next.js `NEXT_PUBLIC_*` variables or any browser bundle.

## Immutable API deployment

Validate the API Compose contract before starting anything:

```bash
docker compose --env-file deploy/oracle/.env.api -f deploy/oracle/docker-compose.api.yml config
```

Pull the immutable image and start the API:

```bash
docker compose --env-file deploy/oracle/.env.api -f deploy/oracle/docker-compose.api.yml pull
docker compose --env-file deploy/oracle/.env.api -f deploy/oracle/docker-compose.api.yml up -d --remove-orphans
```

The container is non-root, read-only, capability-dropped, and bound to `127.0.0.1:8000` by default. The host ingress layer should proxy HTTPS to that loopback port.

Verify locally on the API host:

```bash
curl --fail --silent http://127.0.0.1:8000/api/v1/health
curl --fail --silent http://127.0.0.1:8000/api/v1/ready
```

`/api/v1/health` verifies the process is alive. `/api/v1/ready` is the release gate and remains HTTP 503 until required worker/dependency readiness is satisfied.

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

1. confirm the API container is healthy;
2. confirm all six worker Compose services are running;
3. confirm worker logs show successful startup and heartbeat publication;
4. confirm Supabase `get_release_readiness()` reports zero missing/stale workers;
5. confirm `/api/v1/health` returns 200;
6. confirm `/api/v1/ready` returns 200 and `status=ready`;
7. only then run a controlled real-user scientific workflow.

## Rollback

Rollback is image-reference based. Keep the previous successful API and worker release references.

For the API, replace `GENITHM_API_IMAGE` in `.env.api` with the previous digest, then run `docker compose pull` followed by `docker compose up -d --remove-orphans`.

For workers, replace the six digest references in `.env.workers` with the previous release's immutable references, then run `docker compose pull` followed by `docker compose up -d --remove-orphans`.

Do not purge Supabase queues during rollback. Existing visibility timeouts and bounded retry/finalization semantics are designed so queued work can recover after a worker replacement.

## V1 deployment order

1. Merge and release the multi-architecture worker pipeline.
2. Build and publish the hardened multi-architecture API image.
3. Create Oracle networking and the API/worker compute hosts.
4. Harden the hosts and install Docker/Compose using Oracle-supported packages/instructions.
5. Deploy the six worker images from one successful release artifact.
6. Deploy the Genithm API with backend-only Supabase credentials and allowed frontend origins.
7. Configure the Next.js frontend on Vercel with only public Supabase browser credentials and the production API origin.
8. Integrate Cloudflare R2 for large uploads/results before enabling large-file production workflows.
9. Align the AI runtime with the documented Qwen-primary / DeepSeek-backup provider strategy.
10. Run end-to-end production validation and only then tag V1.

## Kubernetes boundary

The repository retains a Kubernetes worker template for later scaling. V1 Oracle launch does not require Kubernetes. The Docker images, environment contract, queue semantics, readiness checks, and immutable release discipline are intentionally portable so a later Kubernetes migration does not require rewriting scientific worker code.
