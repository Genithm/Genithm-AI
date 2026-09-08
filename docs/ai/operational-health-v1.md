# AI operational health V1

Genithm exposes a bounded, read-only operational view for the three AI lifecycle queues: planner, interpretation, and evidence follow-up.

## Visibility

`public.get_ai_operational_health(target_project_id uuid default null)` requires an authenticated caller.

- organization owners and admins receive organization-wide aggregate metrics for organizations they belong to;
- ordinary members receive aggregates only for requests they created;
- an optional project ID narrows metrics to a project that belongs to one of the caller's organizations;
- the RPC returns aggregates only. It never returns prompts, user questions, frozen evidence, interpretations, follow-up answers, scientific results, storage paths, or secrets.

The function is `SECURITY DEFINER` only so owner/admin aggregate metrics can include other users' lifecycle rows even though the underlying AI request tables are owner-selectable under RLS. The function authenticates the caller, joins only the caller's `organization_members` rows, and applies the owner/admin versus self visibility rule before aggregation. Execution is granted only to `authenticated`.

## Health policy

Each visible organization reports one row for each pipeline:

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
