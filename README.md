# Genithm AI

Genithm AI is an AI-native bioinformatics research platform. The implementation follows a strict separation of concerns:

- AI plans and explains.
- Policy and authorization decide what is allowed.
- Trusted scientific tools perform computation.
- Evidence and provenance record what actually happened.

## Repository layout

- `apps/web` - Next.js + TypeScript web application
- `apps/api` - FastAPI service for Genithm APIs and future scientific orchestration
- `supabase` - database migrations and local Supabase configuration
- `docs` - engineering decisions, security and compliance baselines
- `.github` - CI and dependency automation

## Current milestone

Foundation and Phase 1 authentication/workspace:

1. Secure Supabase schema with Row Level Security
2. User profiles
3. Organizations and memberships
4. Projects
5. Next.js Supabase Auth shell
6. FastAPI health/readiness endpoints
7. CI gates

Genithm includes worker-backed scientific workflows, AI planning, sequence intelligence and provenance. Actual processing requires an appropriately configured development backend and running workers.

## Open the real BioAI assistant in Codespaces

Genithm's **main product** is an authenticated, ChatGPT-style research conversation at
`/dashboard/ai`, with research-specific scientific actions, FASTA ingestion, provenance and
explicit approval before background compute. The `/preview` route is **only a local sample
workbench**, not the Genithm AI product.

Create a GitHub Codespace from `main`. In repository
**Settings → Secrets and variables → Codespaces**, add backend-only
`SUPABASE_SECRET_KEY` (for the existing Genithm Supabase project) and
`GEMINI_API_KEY` and `GROQ_API_KEY`. Restart the Codespace if the secrets were just added.

**Fastest way to run real AI chat even while the six scientific workers are offline:**

```bash
bash scripts/codespaces_bioai.sh
```

It prints the actual `/login` URL. This starts **authenticated Google AI Studio (Gemini) and Groq chat
and project creation**, not the separate scientific API, storage or worker fleet.
New scientific computations are honestly marked unavailable in that mode.

**Full bioinformatics preview with API, temporary storage and six workers:**

```bash
bash scripts/codespaces_preview.sh
```

It must pass its worker/queue readiness checks before its scientific analyses
are considered available. Neither preview is a production deployment.
See [BioAI V32 product journey](docs/bioai-v32-product-experience.md) and
[full Codespaces deployment](docs/deployment/CODESPACES_FULL_PREVIEW.md).
Use your **existing** Supabase project—do not create an extra one as a workaround.

## Local setup

Copy `.env.example` to `.env.local` or the environment file expected by the component you are running. Never commit secret keys.

### Web

```bash
cd apps/web
npm install
npm run dev
```

### API

```bash
cd apps/api
python -m venv .venv
. .venv/bin/activate
pip install -e '.[dev]'
pytest
uvicorn app.main:app --reload
```

## Security

This repository must never contain Supabase secret/service-role keys, database passwords, private research data, or production credentials. See `SECURITY.md` and `docs/security/SECURITY_BASELINE.md`.
