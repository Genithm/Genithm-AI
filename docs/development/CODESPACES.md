# Genithm AI — GitHub Codespaces development

You **do not need Oracle, Kubernetes, or an always-on server** to continue
developing Genithm AI. Codespaces runs the Next.js development preview.
The scientific-worker algorithms can also run locally and offline.

## Open the web preview (two clicks after Codespace starts)

1. Open the `Genithm/Genithm-AI` repository in GitHub, select **Code → Codespaces**,
   and create/open the Codespace on the `main` branch.
2. In Codespaces, choose **Ports → Genithm AI preview (3000) → Open in Browser**.

The Codespace automatically runs `npm ci`, executes the real sequence
algorithm smoke test, and launches Next.js on **private** port 3000. The
opening page links to **Codespaces preview**, a standalone research UI that
works even if Supabase credentials are missing.

If this Codespace predates the new `.devcontainer/devcontainer.json`, run
**Codespaces → Rebuild Container** once after pulling the latest main branch.
The Codespace may need a minute to install locked web dependencies during setup.

If the port is not ready, run:

```bash
bash .devcontainer/setup.sh
bash .devcontainer/start.sh
tail -f /tmp/genithm-codespaces-web.log
```

Do not manually make the preview port public. Port 9000 is no longer
automatically forwarded publicly.

## Interactive scientific lab — real computation, no keys

The `/preview` page now includes **Analyze your own DNA or RNA** beneath
the reference-fixture explorer. Paste plain nucleotides or a single-record FASTA,
choose DNA/RNA, and run **complete ORF discovery, six-frame translation,
IUPAC motif scanning or reverse complement**. A sample `ATGAAATAA` is
preloaded, and the resulting report can be exported as JSON.

This is **actual Python execution of the same bounded algorithms used by
the scientific worker**, not an AI-generated result or hard-coded example.
The tiny Python server binds only to `127.0.0.1:8769`, never forwards a
second port, requires no database, and runs no external network requests.
The Next.js proxy route is **development-only**, accepts only same-origin
JSON requests, and rejects oversized payloads. The lab limits runs to
**5,000 nucleotide bases**, two simultaneous computations, and the
engine's bounded result counts.

No user accounts, customer jobs, billing or permanent storage are created
by this lab. Its local exported JSON includes a reproducible input SHA-256
fingerprint, but it is **not an authenticated, signed scientific job artifact**.

If the results panel reports the local engine is unavailable:

```bash
bash .devcontainer/start.sh
curl -fsS http://127.0.0.1:8769/health
tail -n 60 /tmp/genithm-codespaces-science.log
```

Run its validation tests without npm or any database:

```bash
python3 scripts/test_codespaces_live_lab.py
python3 scripts/test_codespaces_preview.py
```

## Preview versus an authenticated scientific workspace

**Offline development lab (no keys):** The `/preview` page contains both clearly labeled reference examples and a live local scientific input form. The local lab computes results from a sequence you paste; no customer job is submitted, no user is impersonated, and no data is sent to Supabase.

**Authenticated development (optional):** Create a **separate Supabase
development project**, not Genithm's production project. Apply reviewed
migrations to that development database using the Supabase CLI.
In **Codespaces → Secrets**, configure:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
```

These are Supabase's **public browser** values, not `service_role` or
`sb_secret_` credentials. The Next.js app can use these variables
directly from the Codespace environment. Restart the Codespace or Next.js
process after setting/changing them.

**Do not paste keys in GitHub source, open a public Codespaces port, or
expose server-only keys in `NEXT_PUBLIC_*` variables.**

Actual projects, uploads, authentication, NCBI retrieval, AI chat,
scientific job processing and result downloads require the relevant
backend schema, storage configuration, and running services.
They are **not** simulated by the offline UI demo.

## Run actual science locally (no Supabase account needed)

```bash
python3 scripts/codespaces-science-smoke.py
```

This imports the **real production scientific-worker Python module** and
validates four methods against `ATGAAATAA`:

- ORF discovery with the expected complete `MK` peptide at 1–9.
- Six-frame translation; forward frame +1 is `MK*`.
- IUPAC motif scan for `AAA` at 4–6 on the plus strand.
- Reverse complement `TTATTTCAT`.

For the full worker test suite on a Python 3.13 Codespace:

```bash
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -e './apps/scientific-worker[dev]'
python -m pytest apps/scientific-worker/tests
```

## Optional API and worker development

The API runs independently of the web UI. Install it from its pinned
`pyproject.toml` and run on localhost port 8000. Scientific worker
processing uses secret Supabase credentials and project-specific storage;
only configure it against a development Supabase project after its
migrations, RLS and storage are verified.

A stopped Codespace means **workers stop running**; this is expected.
Do not use Codespaces as public 24/7 production compute. Oracle/Kubernetes
can be introduced later when the product is ready for continuous hosting.

## Troubleshooting

- **"Missing NEXT_PUBLIC_SUPABASE_URL..."**: open `/preview` for an
  offline demo. Add a development project and public environment values for
  real sign-in; the app intentionally blocks authenticated routes without
  these values.
- **Port 3000 not listed**: run `bash .devcontainer/start.sh`, then check
  `tail -n 80 /tmp/genithm-codespaces-web.log`.
- **Changes not appearing**: use Codespaces `git pull` on `main` and
  restart the dev server; after devcontainer changes rebuild once.
- **Scientific jobs stay queued**: unlike the UI demo, real queue processing
  requires a compatible worker running with development-only server secrets.
- **Do not point development at the production Genithm Supabase project.**
  Its Science V2 migrations and deployment activation are not prerequisites
  for this independent preview.
