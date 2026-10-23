# Genithm AI — Full Codespaces preview (real login, API and scientific workers)

**The main Genithm application is NOT the sample workbench at `/preview`.**

## Choose the right mode

- `bash .devcontainer/setup.sh` and `bash .devcontainer/start.sh` launch a simple sample-only developer environment. `/preview` shows local scientific fixtures; it does not prove database, login, API, NCBI or six-worker execution.
- `bash scripts/codespaces_preview.sh` launches the **integrated Codespaces runtime**: real Next.js login/signup, API on 8000, six released worker containers, existing Genithm Supabase Auth/queues, synthetic-data object storage, and Gemini primary and Groq fallback AI. Only this path can qualify as the fully integrated preview.
- The homepage at `/` always prioritizes **Sign in to Genithm** and **Create Research Account**; the optional `/preview` page remains accessible directly to developers but is deliberately not promoted as the product.

## Codespaces prerequisites

In repository **Settings → Secrets and variables → Codespaces**, store exactly these **Codespaces** secret names:

- `SUPABASE_SECRET_KEY`: the backend-only Supabase secret key for the existing project (`vowmjjgkjoxcvlfamukh`).
- `GEMINI_API_KEY` and `GROQ_API_KEY`: Google AI Studio and Groq secret keys.

Optional: `NCBI_API_KEY`, `NCBI_EMAIL`, `GENITHM_GEMINI_MODEL` (default `gemini-3.8-flash`) and `GENITHM_GROQ_MODEL` (default `llama-3.3-70b-versatile`).

A **Supabase publishable key is not the backend secret key**. The public project URL and publishable key are configured automatically by the launcher; you must supply the named backend key. Never commit these credentials or paste them into chat, PRs, logs, or your browser.

GitHub Codespaces exposes the secrets as environment variables. Rebuild or restart the Codespace after adding/changing repository secrets. If the launcher reports missing secrets, verify the secret **names and Codespaces scope** first; don't reveal values.

## Fix missing Docker after creating a Codespace

The **full** preview requires Docker Engine and Compose v2 to start the API, six workers
and temporary object storage. The Genithm devcontainer installs the
`ghcr.io/devcontainers/features/docker-in-docker:4` feature on a **container build**.

If `scripts/codespaces_preview.sh` reports `Required tool is missing: docker`,
the current Codespace was created before the Docker feature was enabled (or
its container was not successfully rebuilt). **Running `git pull` does not
install container features.** From the existing Codespaces terminal:

```bash
git switch main
git pull --ff-only
```

Then open the VS Code Command Palette (**Ctrl/Cmd+Shift+P**), run
**Codespaces: Rebuild Container**, and wait for installation to finish.
Rebuilding restarts the development container and applies Docker-in-Docker
from the updated `.devcontainer/devcontainer.json`. If that command is not
available or the container build fails, create a **new Codespace from main**
and let its setup complete. Building multiple scientific worker containers
may require a Codespaces machine with sufficient memory and compute.

After the rebuild, check Docker from the same terminal:

```bash
docker --version
docker compose version
docker info
```

All three must succeed. Do **not** copy service credentials into terminal
messages or commit them to GitHub. Your Codespaces secrets must be configured
under the repository's Codespaces secrets and may require a restart before
they become available.

Then launch the full application:

```bash
bash scripts/codespaces_preview.sh
```

If you only want the **real authenticated Genithm BioAI chat immediately**,
and cannot use Docker yet, run `bash scripts/codespaces_bioai.sh`.
That chat-only mode deliberately disables worker-backed computation and
is **not** the full integrated scientific preview.

## Fix MinIO Quay 401 on fresh preview startup

If startup reaches `docker compose pull` but fails with:

```text
failed to resolve reference "quay.io/minio/minio:latest": 401 Unauthorized
```

the upstream MinIO Quay registry no longer supports anonymous pulls. This is
**not a Supabase or Codespaces Docker failure**. The full-preview Compose
configuration now uses **PGSTY SILO**, a maintained S3/MinIO-compatible server,
pinned to its public multi-platform September 2026 release and exact image
digest. The image includes `mcli`, so the one-time bucket setup no longer
pulls `quay.io/minio/mc:latest`. The API and worker S3 endpoint stays
`http://minio:9000`; service names and signed-URL behavior do not change.

The fix only changes Docker Compose and the launcher, so you **do not need
another container rebuild** when Docker already works:

```bash
git pull --ff-only
bash scripts/codespaces_preview.sh
```

The launcher now pulls the pinned storage image **before npm ci**, to fail
quickly and show the registry problem if the replacement is unreachable.

For an isolated storage-only check, inspect the Compose service list with your
existing protected `.env.codespaces-preview`:

```bash
docker compose --env-file .env.codespaces-preview \
  -f deploy/codespaces/docker-compose.preview.yml config --services
```

Do not publish the private port 3000 URL or paste Codespaces secret values.
This replacement is for **disposable local preview storage**, not a production
storage migration. Never upload confidential research to this preview.

## Launch the real product

From the **repository root** in a Codespaces terminal:

```bash
git pull --ff-only
bash scripts/codespaces_preview.sh
```

The launcher replaces an automatically started sample server on port 3000, writes protected `apps/web/.env.local` with the public Supabase client settings, backend-only `SUPABASE_SECRET_KEY`, `GENITHM_SCIENCE_V22_ENABLED=true`, the API proxy, and the Codespaces web origin, and starts the actual API/worker stack from a coordinated V1 candidate release.

It verifies Supabase email/password signup availability, Gemini and Groq model availability, backend release images, API and web health, plus **six current worker heartbeats and nine existing queues**. If any check fails, the launcher exits nonzero. Do **not** interpret a mere port-3000 page as a complete scientific preview.

A successful launcher prints a private forwarded HTTPS URL:

```text
Genithm FULL preview is running and passed readiness checks.
Open your real sign-in page: https://<codespace>-3000.<forwarding-domain>/login
Create an account: https://<codespace>-3000.<forwarding-domain>/signup
```

Keep your Codespace application port **private**. A temporary port-9000 object-storage endpoint may be marked public to permit short-lived signed browser uploads. Never upload real/private customer research to preview storage. Stop the Codespace when done.

### Account creation / email confirmation

If the existing Supabase project requires email confirmation, the application's callback uses `GENITHM_APP_URL` for the full Codespaces origin. Configure that **exact forwarded origin plus `/auth/confirm`** in the existing Supabase project's Auth URL allowlist, using the project's dashboard. Use a dedicated test user and confirm their email. Avoid opening wildcard redirects to arbitrary domains.

## Test after boot

1. Open `/login` or `/signup` to authenticate to the **real app**, not `/preview`.
2. Create a development organization and project; open `/dashboard/ai`.
3. Ask ordinary AI questions and check Gemini and Groq responses.
4. Test a supported single-accession NCBI workflow with explicit human approval: `Calculate protein properties for NP_000537.3` or `Run ORF scan on NM_000546.6`.
5. Validate persisted job state, real NCBI retrieval, FASTA integrity, scientific result fingerprint and evidence dossier/download. Recorded computational output is not experimentally verified biology.
6. Test the authenticated research archive, integrity-checked evidence export and denial of cross-account access.

For a basic deterministic local science smoke, run:

```bash
python3 scripts/codespaces-science-smoke.py
```

For live local API/web readiness, run from repository root:

```bash
python3 scripts/production_smoke.py \
  --api-base-url http://127.0.0.1:8000 \
  --web-base-url http://127.0.0.1:3000 --allow-http
```

A Codespaces preview is not proof that the separate Oracle or Cloudflare **production** deployment is working. Payments still need separate provider sandbox credentials.

## Troubleshooting

- **Only sample DNA tools, no login:** You are at `/preview` or ran only `.devcontainer/start.sh`. Open `/login` from the actual forwarded application origin, and run `bash scripts/codespaces_preview.sh` for complete backend services.
- **Login fails / missing environment:** Use the full launcher, check your secret name and whether `apps/web/.env.local` exists. Never print secret values for debugging.
- **Port 3000 busy:** The launcher attempts to stop the previous sample process. If it cannot free the port, stop the old Next.js dev process and rerun it. Check the `PORTS` tab.
- **Missing GHCR image:** The candidate API and six-worker release images must exist at the same exact source revision; do not substitute floating `latest` tags.
- **Worker readiness not ready:** Inspect `docker compose --env-file .env.codespaces-preview -f deploy/codespaces/docker-compose.preview.yml ps` and the worker logs. All six must heartbeat before the launcher claims successful activation.
- **AI provider rejected:** Check the selected model exists for that key and the key has the required provider permissions.
- **Web error:** Inspect `tail -n 60 .codespaces-web.log` and the Codespaces terminal output, redact credentials before sharing.
