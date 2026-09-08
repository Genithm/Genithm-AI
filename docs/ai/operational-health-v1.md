# AI operational health V1

Genithm exposes a bounded, read-only operational view for the three AI lifecycle queues: planner, interpretation, and evidence follow-up.

## Visibility

`public.get_ai_operational_health(target_project_id uuid default null)` requires an authenticated caller.

- every caller receives aggregate metrics only for AI requests they created;
- the underlying AI request-table RLS policies remain the final authorization boundary;
- an optional project ID narrows metrics to the caller's own requests in that project;
- the RPC returns aggregates only. It never returns prompts, user questions, frozen evidence, interpretations, follow-up answers, scientific results, storage paths, or secrets.

The function is `SECURITY INVOKER` with an empty `search_path`. It also filters each source table by `requested_by = auth.uid()` as defense in depth. Execution is granted only to `authenticated`; `anon` and `service_role` cannot invoke the public RPC.

Organization-wide owner/admin metrics are intentionally deferred from V1 rather than bypassing the owner-scoped RLS policies with an authenticated `SECURITY DEFINER` endpoint.

## Health policy

Each organization represented by the caller's visible requests reports one row for each pipeline:

- `planner`
- `interpretation`
- `evidence_followup`

A pipeline is marked `attention` if any of these conditions is true:

- an error occurred in the last 24 hours;
- the oldest queued request has waited more than 5 minutes;
- the oldest active request has been active more than 15 minutes.

Otherwise the pipeline is `healthy`.

Metrics include queued and active counts, terminal and error counts for the last 24 hours, oldest queued/active ages, maximum processing attempts observed in the selected scope, and the database refresh timestamp.

## Non-goals

V1 does not automatically retry, cancel, mutate, or repair requests. It does not inspect PGMQ message bodies and does not expose scientific payloads. Operational visibility is separate from the scientific evidence and AI explanation trust layers.
