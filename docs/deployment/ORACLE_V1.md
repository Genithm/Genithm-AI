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

## API and Storage Gateway secrets

Create `deploy/oracle/.env.api` on the API host from `.env.api.example`. The real file must never be committed.

Required runtime values include:

- `GENITHM_API_IMAGE` — digest-pinned API image reference
- `GENITHM_API_ALLOWED_ORIGINS` — production frontend origin(s)
- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY`
- `GENITHM_R2_ENDPOINT`
- `GENITHM_R2_ACCESS_KEY_ID`
- `GENITHM_R2_SECRET_ACCESS_KEY`
- `GENITHM_R2_SEQUENCE_BUCKET`

The Supabase secret/service credential and R2 credentials are backend-only. Never copy them into Next.js `NEXT_PUBLIC_*` variables or any browser bundle.

The browser receives only short-lived object-specific R2 presigned URLs. The database stores provider-neutral metadata, logical bucket, scoped object key, size, validation checksum, and provenance rather than object bytes.

## R2 bucket boundary

Create the private R2 sequence bucket named by `GENITHM_R2_SEQUENCE_BUCKET`. Configure browser CORS only for the production Vercel origin(s) that need direct upload access. Allow `PUT` with `Content-Type` for signed uploads and `GET` only where signed downloads are used. Do not make the bucket public and do not expose R2 API credentials to the browser.

Genithm object keys are generated server-side from authorized organization/project/user/upload identifiers. The browser cannot choose an arbitrary storage key. Existing Supabase Storage objects remain supported during migration.

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

`/api/v1/health` verifies the process is alive. `/api/v1/ready` is the release gate and remains HTTP 503 in production until Supabase readiness and the R2 Storage Gateway configuration are present.

## Frontend configuration

Vercel needs only browser-safe configuration. Set the existing public Supabase browser values and:

```text
NEXT_PUBLIC_GENITHM_API_URL=https://<production-api-origin>
```

Do not place `SUPABASE_SECRET_KEY`, R2 access keys, AI provider keys, or audit private keys in Vercel `NEXT_PUBLIC_*` variables.

Sequence upload flow is: browser session → authenticated Genithm API reservation → short-lived R2 presigned PUT → API metadata verification → service-only queue completion → deterministic sequence worker validation.

## Worker secrets

Create `deploy/oracle/.env.workers` on the worker host from `.env.workers.example`. The real file must never be committed.

Required runtime values:

- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`
- `NCBI_EMAIL`
- R2 endpoint/access-key/secret/bucket values for the sequence worker
- `GENITHM_AI_PRIMARY_PROVIDER` — V1 default: `qwen`
- `GENITHM_AI_PRIMARY_API_KEY`
- `GENITHM_AI_PRIMARY_ENDPOINT`
- `GENITHM_AI_PRIMARY_MODEL`
- `GENITHM_AI_BACKUP_PROVIDER` — V1 default: `deepseek`
- `GENITHM_AI_BACKUP_API_KEY`
- `GENITHM_AI_BACKUP_ENDPOINT`
- `GENITHM_AI_BACKUP_MODEL`
- `GENITHM_AUDIT_SIGNING_KEY_ID`
- `GENITHM_AUDIT_SIGNING_PRIVATE_KEY_BASE64`

Optional/configuration values:

- `NCBI_API_KEY`
- `GENITHM_AI_PRIMARY_PROTOCOL` — defaults to `chat_completions`
- `GENITHM_AI_BACKUP_ENABLED` — defaults to `true`
- `GENITHM_AI_BACKUP_PROTOCOL` — defaults to `chat_completions`

Provider endpoints and model identifiers are deployment configuration rather than application constants. V1 sends each operation to Qwen first and uses DeepSeek only when the primary failure is explicitly eligible for fallback. The accepted provider/model identity is persisted with AI provenance.

## Immutable worker deployment

Use only the six digest-pinned references from a successful Worker release artifact for the exact tested main commit. Do not deploy `latest` tags or hand-built local images.

On the worker host, place the release references in `.env.workers`, then validate the Compose file before starting anything:

```bash
docker compose --env-file deploy/oracle/.env.workers -f deploy/oracle/docker-compose.workers.yml config
docker compose --env-file deploy/oracle/.env.workers -f deploy/oracle/docker-compose.workers.yml pull
docker compose --env-file deploy/oracle/.env.workers -f deploy/oracle/docker-compose.workers.yml up -d --remove-orphans
docker compose --env-file deploy/oracle/.env.workers -f deploy/oracle/docker-compose.workers.yml ps
```

All six services must remain running: sequence, source, BLAST, scientific, audit, and AI workers.

## Release readiness gate

Workers report heartbeats through the existing Genithm operational contract. Do not declare the release ready merely because containers are running.

After deployment:

1. confirm the API container is healthy;
2. confirm all six worker Compose services are running;
3. confirm worker logs show successful startup and heartbeat publication;
4. confirm Supabase `get_release_readiness()` reports zero missing/stale workers;
5. confirm `/api/v1/health` returns 200;
6. confirm `/api/v1/ready` returns 200 and `status=ready`;
7. perform an authenticated R2 FASTA upload and confirm deterministic validation reaches `ready`;
8. only then run the complete controlled real-user scientific workflow.

## Rollback

Rollback is image-reference based. Keep the previous successful API and worker release references.

For the API, replace `GENITHM_API_IMAGE` in `.env.api` with the previous digest, then run `docker compose pull` followed by `docker compose up -d --remove-orphans`.

For workers, replace the six digest references in `.env.workers` with the previous release's immutable references, then run `docker compose pull` followed by `docker compose up -d --remove-orphans`.

Do not purge Supabase queues during rollback. Existing visibility timeouts and bounded retry/finalization semantics allow queued work to recover after worker replacement. Legacy Supabase Storage rows remain readable while R2-backed rows are distinguished by storage-provider metadata.

## V1 deployment order

1. Merge and release the multi-architecture worker pipeline.
2. Build and publish the hardened multi-architecture API image.
3. Align the AI runtime with the documented Qwen-primary / DeepSeek-backup provider layer.
4. Merge the R2 Storage Gateway and provider-aware sequence worker path.
5. Create Oracle networking and the API/worker compute hosts.
6. Harden the hosts and install Docker/Compose using Oracle-supported packages/instructions.
7. Create/configure the private R2 sequence bucket and restricted browser CORS.
8. Deploy the six worker images from one successful release artifact.
9. Deploy the Genithm API with backend-only Supabase/R2 credentials and allowed frontend origins.
10. Configure the Next.js frontend on Vercel with public Supabase browser credentials and `NEXT_PUBLIC_GENITHM_API_URL`.
11. Run end-to-end production validation and only then tag V1.

## Kubernetes boundary

The repository retains a Kubernetes worker template for later scaling. V1 Oracle launch does not require Kubernetes. The Docker images, environment contract, queue semantics, readiness checks, and immutable release discipline are intentionally portable so a later Kubernetes migration does not require rewriting scientific worker code.
