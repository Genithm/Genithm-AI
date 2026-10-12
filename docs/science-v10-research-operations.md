# Science V10 — unified authenticated research operations

## User-facing production functionality

New **/dashboard/operations** combines nine existing job pipelines (scientific jobs, BLAST, NCBI retrieval, protein annotation, sequence input validation, AI planning, AI interpretation, AI evidence follow-up and multi-step AI workflows) into one responsive research command center.

The page offers an authenticated project filter; high-signal status counts, status distribution, advisory attention signals, nine-pipeline filters, search, newest/oldest/review-first ordering, 30-second refresh while an active job is visible, manual refresh, and links to the authoritative job or conversation.

The global dashboard navigation and legacy AI health screen both link into this new view.

## Authorization and data minimization

- All reads use the existing session-scoped Supabase client with existing per-table RLS policies; **there is no service-role or bypass role**.
- No SQL migration, new table, elevated function, write RPC or job retry action.
- Each query selects *only* operational metadata needed for the UI (UUIDs, project, status, timestamps, attempts and short source titles). **No prompts, raw sequences, frozen AI evidence, completions, storage paths or provider errors** are selected.
- Job and conversation navigation destinations derive from validated UUIDs and fixed internal routes; never from uncontrolled URLs or database text.
- A user can select only a project in their RLS-authorized projects list. A forged/inaccessible project filter returns not found.
- Query failures render a source-specific **incomplete snapshot** warning, not an incorrect all-healthy state.
- The latest **60 rows per pipeline** are included, at most 540 records per refresh; counts and plots are *recent visible sample* statistics, not authoritative all-time totals. This is intentional to bound query and client costs.

## Operational interpretation

Explicit states: queued, running, needs approval, completed, failed, cancelled and unknown. Unknown statuses are flagged for human review. Completed-but-no-mapping protein or NCBI not-found outcomes are recorded as nonfailure terminal states. An AI plan requiring confirmation is **needs approval** rather than a failed computation.

Heuristic review thresholds are strict greater-than 5 minutes queued and 15 minutes running; these are **not guarantees** of stuck jobs. Where available, processing_started_at is used rather than creation time for running age. A failed record is flagged immediately. No automatic replay, resubmission or retry is invoked because this would be unsafe without an approved idempotent, permission-checked backend replay policy.

The homepage scientific-job active count is corrected to exclude the real terminal \`error\` state.

## Regression and release

The Node regression suite checks every pipeline, AI confirmation, terminal no-match outcomes, queue/active timing boundaries, unknown statuses, deterministic summaries, forged UUIDs/links, clean labels and omission of sensitive failure bodies. GitHub web CI enforces it alongside pre-existing scientific artifact and download integrity tests, TypeScript typecheck, and Next.js build; Cloudflare contract continues separately.

\`\`\`sh
cd apps/web
npm ci
node --experimental-strip-types --test tests/research-operations.test.mjs
npm run typecheck
npm run build
\`\`\`

This is real application source development, not a Codespaces-only preview. No live Supabase mutation, Oracle deployment or user preview is required. Run normal release controls before production rollout.
