-- Cover the composite conversation/project/org/requester foreign key used by AI workflow runs.
create index if not exists ai_workflow_runs_plan_scope_fk_idx
on public.ai_workflow_runs (conversation_id, project_id, organization_id, requested_by);
