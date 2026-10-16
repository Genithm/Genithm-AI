# Genithm AI — Full Codespaces preview (real login, API and scientific workers)

**The main Genithm application is NOT the sample workbench at `/preview`.**

## Choose the right mode

- `bash .devcontainer/setup.sh` and `bash .devcontainer/start.sh` launch a simple sample-only developer environment. `/preview` shows local scientific fixtures; it does not prove database, login, API, NCBI or six-worker execution.
- `bash scripts/codespaces_preview.sh` launches the **integrated Codespaces runtime**: real Next.js login/signup, API on 8000, six released worker containers, existing Genithm Supabase Auth/queues, synthetic-data object storage, and OpenRouter AI. Only this path can qualify as the fully integrated preview.
- The homepage at `/` always prioritizes **Sign in to Genithm** and **Create Research Account**; the optional `/preview` page remains accessible directly to developers but is deliberately not promoted as the product.

## Codespaces prerequisites

In repository **Settings → Secrets and variables → Codespaces**, store exactly these **Codespaces** secret names:

- `SUPABASE_SECRET_KEY`: the backend-only Supabase secret key for the existing project (`vowmjjgkjoxcvlfamukh`).
- `OPENROUTER_API_KEY`: the OpenRouter provider key for your account.

Optional: `DEEPSEEK_API_KEY` (backup only), `NCBI_API_KEY`, `NCBI_EMAIL`, and `GENITHM_AI_PRIMARY_MODEL` (default `openrouter/free`).

A **Supabase publishable key is not the backend secret key**. The public project URL and publishable key are configured automatically by the launcher; you must supply the named backend key. Never commit these credentials or paste them into chat, PRs, logs, or your browser.

GitHub Codespaces exposes the secrets as environment variables. Rebuild or restart the Codespace after adding/changing repository secrets. If the launcher reports missing secrets, verify the secret **names and Codespaces scope** first; don't reveal values.

## Launch the real product

From the **repository root** in a Codespaces terminal:

```bash
git pull --ff-only
bash scripts/codespaces_preview.sh
```

The launcher replaces an automatically started sample server on port 3000, writes protected `apps/web/.env.local` with the public Supabase client settings, backend-only `SUPABASE_SECRET_KEY`, `GENITHM_SCIENCE_V22_ENABLED=true`, the API proxy, and the Codespaces web origin, and starts the actual API/worker stack from a coordinated V1 candidate release.

It verifies Supabase email/password signup availability, OpenRouter key/model availability, backend release images, API and web health, plus **six current worker heartbeats and nine existing queues**. If any check fails, the launcher exits nonzero. Do **not** interpret a mere port-3000 page as a complete scientific preview.

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
3. Ask ordinary AI questions and check OpenRouter responses.
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
- **OpenRouter rejected:** Check the selected model exists for that key and the key has the required provider permissions.
- **Web error:** Inspect `tail -n 60 .codespaces-web.log` and the Codespaces terminal output, redact credentials before sharing.
