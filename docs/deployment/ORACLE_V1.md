# Genithm V1 — Oracle Cloud deployment

This runbook implements the V1 infrastructure direction documented for Genithm: Vercel/Next.js for the frontend, Oracle Cloud for API/compute and long-running scientific workers, Supabase for PostgreSQL/Auth, and Cloudflare for protected public ingress plus R2 large-object storage.

## V1 topology

Use two Oracle compute roles rather than putting every responsibility on one VM:

- API host: lightweight VM running the Genithm FastAPI service plus a Cloudflare Tunnel connector.
- Worker host: Ampere A1 ARM64 VM for the six continuously running queue consumers. Workers require outbound HTTPS but no inbound application ports.

The API and worker release pipelines are multi-architecture so the same immutable deployment can run on Oracle ARM64 or conventional AMD64 hosts.

## Network boundary

- Public API traffic enters through a remotely managed Cloudflare Tunnel. The Oracle API NSG must not expose TCP/8000 or another application port to the Internet.
- The API container remains bound to host loopback for local health checks. `cloudflared` reaches the API over the private Compose network at `http://api:8000`.
- The Tunnel connector establishes outbound connections to Cloudflare; no inbound application rule is required on the Oracle host.
- Do not expose worker container ports. The worker host needs outbound DNS and HTTPS for Supabase, NCBI, AI providers, registry pulls, and approved object-storage endpoints.
- Restrict SSH to an administrative source range or private access path. Prefer OCI Bastion and leave direct SSH ingress empty when possible.
- Do not expose database ports because PostgreSQL/Auth remain managed by Supabase.
- Use Oracle VCN security lists/network security groups as an outer boundary in addition to host firewall rules.

## API and Storage Gateway secrets

Create `deploy/oracle/.env.api` on the API host from `.env.api.example`. The real file must never be committed.

Required runtime values include:

- `GENITHM_API_IMAGE` — digest-pinned API image reference
- `GENITHM_CLOUDFLARED_IMAGE` — digest-pinned official Cloudflare Tunnel image
- `GENITHM_CLOUDFLARE_TUNNEL_TOKEN` — runtime-only remotely managed Tunnel token
- `GENITHM_API_ALLOWED_ORIGINS` — production frontend origin(s)
- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY`
- `GENITHM_R2_ENDPOINT`
- `GENITHM_R2_ACCESS_KEY_ID`
- `GENITHM_R2_SECRET_ACCESS_KEY`
- `GENITHM_R2_SEQUENCE_BUCKET`

The Supabase secret/service credential, R2 credentials, and Tunnel token are backend-only. Never copy them into Next.js `NEXT_PUBLIC_*` variables or any browser bundle. The Tunnel token is injected as the `TUNNEL_TOKEN` environment variable so it does not appear in process arguments.

The browser receives only short-lived object-specific R2 presigned URLs. The database stores provider-neutral metadata, logical bucket, scoped object key, size, validation checksum, and provenance rather than object bytes.

## R2 bucket boundary

Create the private R2 sequence bucket named by `GENITHM_R2_SEQUENCE_BUCKET`. Configure browser CORS only for the production Vercel origin(s) that need direct upload access. Allow `PUT` with `Content-Type` for signed uploads and `GET` only where signed downloads are used. Do not make the bucket public and do not expose R2 API credentials to the browser.

Genithm object keys are generated server-side from authorized organization/project/user/upload identifiers. The browser cannot choose an arbitrary storage key. Existing Supabase Storage objects remain supported during migration.

## Cloudflare Tunnel setup

Create a remotely managed Cloudflare Tunnel for the production API hostname. Configure its published application route to forward to:

```text
http://api:8000
```

Copy the generated Tunnel token into `GENITHM_CLOUDFLARE_TUNNEL_TOKEN` on the Oracle API host. Resolve the current official `cloudflare/cloudflared` image to an immutable digest and set `GENITHM_CLOUDFLARED_IMAGE` to that digest-pinned reference. Do not deploy a floating `latest` tag.

The Oracle NSG must have no public application ingress rule for port 8000. Cloudflare Tunnel is the production ingress path; host loopback port 8000 exists only for local health checks and break-glass diagnostics.

## Deployment preflight

Before pulling or starting containers, run the repository preflight from the checkout that matches the release being deployed:

```bash
python scripts/oracle_deploy_preflight.py api --env-file deploy/oracle/.env.api --compose
python scripts/oracle_deploy_preflight.py workers --env-file deploy/oracle/.env.workers --compose
```

The preflight fails when required values are missing, example placeholders remain, external endpoints are not HTTPS, an image is not immutable `@sha256:` OCI reference, Docker is unavailable, or Compose interpolation/configuration fails. It prints validation errors but never prints secret values.

Worker services intentionally receive only the credentials required by their role. Do not reintroduce a shared Compose `env_file` that exposes AI provider keys or the audit signing private key to unrelated scientific workers.

## Immutable API deployment

Validate the API Compose contract before starting anything:

```bash
docker compose --env-file deploy/oracle/.env.api -f deploy/oracle/docker-compose.api.yml config
```

Pull the immutable API and Tunnel images, then start them:

```bash
docker compose --env-file deploy/oracle/.env.api -f deploy/oracle/docker-compose.api.yml pull
docker compose --env-file deploy/oracle/.env.api -f deploy/oracle/docker-compose.api.yml up -d --remove-orphans
docker compose --env-file deploy/oracle/.env.api -f deploy/oracle/docker-compose.api.yml ps
```

The API container is non-root, read-only, capability-dropped, and bound to `127.0.0.1:8000` by default. The `cloudflared` container is also hardened and receives only the Tunnel token. It must remain running alongside the API.

Verify locally on the API host:

```bash
curl --fail --silent http://127.0.0.1:8000/api/v1/health
curl --fail --silent http://127.0.0.1:8000/api/v1/ready
```

Then verify the public production API hostname through Cloudflare:

```bash
curl --fail --silent https://<production-api-origin>/api/v1/health
curl --fail --silent https://<production-api-origin>/api/v1/ready
```

`/api/v1/health` verifies the process is alive. `/api/v1/ready` is the release gate and remains HTTP 503 in production until Supabase readiness, R2 Storage Gateway configuration, and required worker heartbeats are present.

## Frontend configuration

Vercel needs only browser-safe configuration. Set the existing public Supabase browser values and:

```text
NEXT_PUBLIC_GENITHM_API_URL=https://<production-api-origin>
```

Do not place `SUPABASE_SECRET_KEY`, R2 access keys, Tunnel tokens, AI provider keys, or audit private keys in Vercel `NEXT_PUBLIC_*` variables.

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

1. confirm the API and `cloudflared` containers are healthy/running;
2. confirm all six worker Compose services are running;
3. confirm worker logs show successful startup and heartbeat publication;
4. confirm Supabase `get_release_readiness()` reports zero missing/stale workers;
5. confirm the public Cloudflare API `/api/v1/health` returns 200;
6. confirm public `/api/v1/ready` returns 200 and `status=ready`;
7. perform an authenticated R2 FASTA upload and confirm deterministic validation reaches `ready`;
8. run the complete controlled real-user scientific E2E workflow;
9. only then tag V1.

## Rollback

Rollback is image-reference based. Keep the previous successful API, Tunnel, and worker image references.

For the API, replace `GENITHM_API_IMAGE` and, if needed, `GENITHM_CLOUDFLARED_IMAGE` with previous known-good digests, then run `docker compose pull` followed by `docker compose up -d --remove-orphans`.

For workers, replace the six digest references in `.env.workers` with the previous release's immutable references, then run `docker compose pull` followed by `docker compose up -d --remove-orphans`.

Do not purge Supabase queues during rollback. Existing visibility timeouts and bounded retry/finalization semantics allow queued work to recover after worker replacement. Legacy Supabase Storage rows remain readable while R2-backed rows are distinguished by storage-provider metadata.

## V1 deployment order

1. Release immutable multi-architecture worker images and the API image from tested main revisions.
2. Create Oracle networking and the API/worker compute hosts with no public API application-port ingress.
3. Harden the hosts and install Docker/Compose using Oracle-supported packages/instructions.
4. Create/configure the private R2 sequence bucket and restricted browser CORS.
5. Create the remotely managed Cloudflare Tunnel and map the production API hostname to `http://api:8000`.
6. Deploy the six worker images from one successful release artifact.
7. Deploy the API plus digest-pinned `cloudflared` with backend-only Supabase/R2/Tunnel credentials.
8. Configure the Next.js frontend on Vercel with public Supabase browser credentials and `NEXT_PUBLIC_GENITHM_API_URL`.
9. Run readiness, production smoke, and the complete authenticated production E2E flow.
10. Tag V1 only after every release gate passes.

## Kubernetes boundary

The repository retains a Kubernetes worker template for later scaling. V1 Oracle launch does not require Kubernetes. The Docker images, environment contract, queue semantics, readiness checks, and immutable release discipline are intentionally portable so a later Kubernetes migration does not require rewriting scientific worker code.
