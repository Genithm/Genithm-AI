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

## Codespaces: no Oracle deployment required

Open **Code → Codespaces** from GitHub, start a Codespace, then select
**Ports → Genithm AI preview (3000) → Open in Browser**.

The Codespace automatically installs the locked Next.js dependencies, starts
the UI, and runs four actual scientific algorithm smoke tests. Visit
`/preview` to explore the offline research workbench without Supabase keys.
Real authenticated features need a **separate development Supabase project**.

Full instructions: [GitHub Codespaces development](docs/development/CODESPACES.md).

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
