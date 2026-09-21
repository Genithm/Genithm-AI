-- Normalize AI plan request status validation to one canonical constraint.
-- Earlier migrations replaced ai_plan_requests_status_check while the original
-- ai_plan_requests_status constraint remained active and rejected newer
-- conversation/clarification states.

alter table public.ai_plan_requests
  drop constraint if exists ai_plan_requests_status;

alter table public.ai_plan_requests
  drop constraint if exists ai_plan_requests_status_check;

alter table public.ai_plan_requests
  add constraint ai_plan_requests_status
  check (status in (
    'queued',
    'planning',
    'conversation',
    'ready',
    'clarification_required',
    'unsupported',
    'error',
    'dispatched'
  ));
