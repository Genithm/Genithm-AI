# V50 development startup and verification

Genithm is in development, not a hosted production release. This patch fixes the
Next.js security dependency and the browser CI runner mismatch, and makes the
preview use backend images matching its checked-out code rather than an old V1
candidate. Scientific approvals, tenant checks, validators and result hashes remain
in place. An interrupted AI response is not stored as a completed evidence answer.

## Start with the existing Codespaces secrets

Keep `GEMINI_API_KEY`, `GROQ_API_KEY`, and the existing `SUPABASE_SECRET_KEY` in
repository **Settings > Secrets and variables > Codespaces**. Do not put AI keys
in Supabase tables, commits, public environment variables, screenshots or chat.
Stop and restart an existing Codespace after adding or changing secrets.

From the repository root:

```bash
git pull --ff-only
bash scripts/codespaces_preview.sh
```

The launcher performs small REAL structured inference checks against Gemini and
Groq separately, using the application's worker adapter and output validator.
These checks use API quota. It reports only provider/model identifiers and elapsed
milliseconds, never keys, prompts, or raw provider error bodies. Failure in either
account prevents a false ready message. Both providers' model IDs remain configurable.

For a standalone account check:

```bash
python3 scripts/check_ai_provider_models.py --inference
```

Without `--inference`, only model discovery is checked, not inference or quota.
Google model pagination is followed within bounds. Invalid credentials, denied model
permissions, quota/rate limits, missing models and incomplete JSON are distinguished
without exposing upstream bodies. The checks must be run in the environment holding
the keys; a GitHub source/CI connection does not receive Codespaces secrets.

## What startup does

The full preview aligns web/API/worker revisions. Missing matching published images
are built locally from the same source; older runtime overrides fail with a clear
message. Pinned Docker bases and package lockfiles are retained. Local builds consume
existing Codespace CPU/disk and do not provision new cloud resources.

The chat-only option remains `bash scripts/codespaces_bioai.sh`; it cannot execute
worker-backed science. Both launchers refresh locked frontend dependencies and write
server environment files with private permissions. Start completion checks are not
claims that every scientific workflow has been validated on arbitrary datasets.

## Scope boundaries

The six ordinary scientific/AI workers and validated small-sequence path are covered
by full preview startup. Managed multi-gigabyte files and paired verification remain
explicitly opt-in: their private bucket, verifier processes and per-project quotas
must be configured per `deploy/large-data/README.md`. No new quotas or paid storage
are created by V50. Do not mistake an upload policy ceiling for tested capacity.

Browser CI runs the real app against loopback authentication/data fixtures. It is not
a live-user-account test. Live inference timing is measured only by the account
check, not inferred from mocked streaming tests. A passing test suite does not
establish that no undiscovered bugs remain.
