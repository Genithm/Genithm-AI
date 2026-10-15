-- Science V22: durable, user-owned chat -> fixed scientific pipeline lineage.
-- Source-only migration. Do NOT apply to production until reviewed and staged.
-- Existing ai_messages SELECT RLS remains in force; no user INSERT/UPDATE grants.
-- A scoped foreign key prevents accidental cross-tenant lineage even by
-- privileged internal code. Existing run IDs are already unique, so the
-- additional compound key cannot reject otherwise-valid historical rows.
alter table public.research_pipeline_runs
  add constraint research_pipeline_chat_scope_unique
    unique (id,project_id,organization_id,requested_by);

alter table public.ai_messages
  add column protocol_input_scope text,
  add column research_pipeline_run_id uuid;

alter table public.ai_messages
  add constraint ai_messages_protocol_scope_ck
    check (protocol_input_scope is null or protocol_input_scope in ('text_only','with_attachments')),
  add constraint ai_messages_scoped_research_run_fk
    foreign key (research_pipeline_run_id,project_id,organization_id,conversation_owner_id)
    references public.research_pipeline_runs(id,project_id,organization_id,requested_by)
    on delete restrict,
  add constraint ai_messages_authorized_research_link_ck
    check (
      research_pipeline_run_id is null
      or (protocol_input_scope is not distinct from 'text_only'
          and cardinality(attachment_upload_ids)=0
          and role='user'
          and plan_request_id is null)
    );

create index ai_messages_fixed_research_lookup_idx
  on public.ai_messages(conversation_id,created_at desc)
  where research_pipeline_run_id is not null;

-- Service-only mark: old messages stay NULL (unverified), never silently
-- considered text-only. The authenticated browser has no permission to set it.
create or replace function app_private.mark_chat_protocol_input_scope(
  p_message_id uuid, p_expected_user_id uuid, p_has_media boolean
) returns void language plpgsql security definer set search_path='' as $$
declare source public.ai_messages%rowtype;
begin
  select * into source from public.ai_messages
    where id=p_message_id and role='user'
    and conversation_owner_id=p_expected_user_id for update;
  if not found then
    raise exception 'chat message not found' using errcode='P0002';
  end if;
  if source.protocol_input_scope is not null then
    raise exception 'chat input scope already sealed' using errcode='23505';
  end if;
  update public.ai_messages
  set protocol_input_scope=case
    when coalesce(p_has_media,false) or cardinality(source.attachment_upload_ids)>0
      then 'with_attachments' else 'text_only' end
  where id=source.id;
end $$;
revoke all on function app_private.mark_chat_protocol_input_scope(uuid,uuid,boolean)
  from public,anon,authenticated,service_role;
grant execute on function app_private.mark_chat_protocol_input_scope(uuid,uuid,boolean)
  to service_role;

create or replace function public.mark_chat_protocol_input_scope(
  user_message_id uuid, expected_user_id uuid, has_media boolean
) returns void language sql security invoker set search_path=''
as $$ select app_private.mark_chat_protocol_input_scope(user_message_id,expected_user_id,has_media); $$;
revoke all on function public.mark_chat_protocol_input_scope(uuid,uuid,boolean)
  from public,anon,authenticated,service_role;
grant execute on function public.mark_chat_protocol_input_scope(uuid,uuid,boolean)
  to service_role;

-- Hardened DB parser: no client-supplied template, accession or run id.
-- This intentionally accepts a subset of conversational language.
create or replace function app_private.parse_fixed_chat_protocol(p_text text)
returns table(template text,accession text)
language plpgsql immutable set search_path='' as $$
declare
  input_text text := trim(coalesce(p_text,''));
  refs text[];
  acc text;
  direct_action text := '(run|analy[sz]e|scan|find|detect|calculate|compute|profile|perform|retrieve|fetch)';
begin
  if char_length(input_text) not between 1 and 8000
    or position(chr(10) in input_text)>0
    or position(chr(13) in input_text)>0
    or position(chr(92)||'n' in input_text)>0
    or position(chr(92)||'r' in input_text)>0 then return; end if;
  -- Match the same action-word boundary as the chat UI: digits and
  -- underscores are part of an identifier, not a command separator.
  if not (
    input_text ~* ('^(please[[:space:]]+|kindly[[:space:]]+)?'||direct_action||'([^[:alnum:]_]|$)')
    or input_text ~* ('^(can|could|would|will)[[:space:]]+you[[:space:]]+(please[[:space:]]+)?'||direct_action||'([^[:alnum:]_]|$)')
    or input_text ~* ('^i[[:space:]]+(want|would[[:space:]]+like)[[:space:]]+(you[[:space:]]+)?to[[:space:]]+'||direct_action||'([^[:alnum:]_]|$)')
  ) then return; end if;
  if input_text ~* '(don''t|do not|never|without|avoid|instead of|rather than|ignore[[:space:]]+(previous|prior|all)|system[[:space:]]+prompt|developer[[:space:]]+instructions?|python|javascript|script|shell|terminal|execute|command)' then
    return;
  end if;
  select pg_catalog.array_agg(parts[1]) into refs
  from pg_catalog.regexp_matches(
    upper(input_text),
    '((NM|NR|XM|XR|NC|NG|NT|NW|NP|XP|YP|WP)_[0-9]{4,12}(\.[0-9]{1,4})?)','g'
  ) as captured(parts);
  if coalesce(cardinality(refs),0)<>1 then return; end if;
  acc := refs[1];
  -- A partial accession or an extra numeric version suffix is not valid.
  if upper(input_text) !~ ('(^|[^A-Z0-9_])'||replace(acc,'.','\.')||'($|[^A-Z0-9_])')
    or upper(input_text) ~ (replace(acc,'.','\.')||'\.[0-9]') then return; end if;
  if acc ~ '^(NM|NR|XM|XR|NC|NG|NT|NW)_'
    and input_text ~* '(^|[^[:alnum:]_])(orf|orfs|open reading frames?)([^[:alnum:]_]|$)'
    and input_text !~* '(protein properties|protein profiling)' then
    template := 'ncbi_nucleotide_orf_v1'; accession := acc; return next; return;
  end if;
  if acc ~ '^(NP|XP|YP|WP)_'
    and input_text ~* '(protein (properties|profile|profiling)|molecular weight|isoelectric point|protein characterization)'
    and input_text !~* '(orf|open reading frame)' then
    template := 'ncbi_protein_profile_v1'; accession := acc; return next; return;
  end if;
end $$;
revoke all on function app_private.parse_fixed_chat_protocol(text)
  from public,anon,authenticated,service_role;

-- One authenticated RPC seals the link in the same transaction that requests
-- the audited NCBI retrieval -> validation -> science pipeline.
create or replace function app_private.approve_chat_research_pipeline(p_message_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  actor uuid := auth.uid();
  source public.ai_messages%rowtype;
  convo public.ai_conversations%rowtype;
  protocol record;
  run_id uuid;
  run public.research_pipeline_runs%rowtype;
begin
  if actor is null then raise exception 'authentication required' using errcode='42501'; end if;
  select * into source from public.ai_messages
    where id=p_message_id and role='user' and conversation_owner_id=actor
    for update;
  if not found then raise exception 'chat message not found' using errcode='P0002'; end if;
  select * into convo from public.ai_conversations
    where id=source.conversation_id and project_id=source.project_id
      and organization_id=source.organization_id
      and created_by=actor and status='active';
  if not found or not app_private.is_org_member(source.organization_id) then
    raise exception 'chat conversation not accessible' using errcode='42501';
  end if;
  if source.protocol_input_scope is distinct from 'text_only'
    or cardinality(source.attachment_upload_ids)<>0
    or source.plan_request_id is not null then
    raise exception 'chat message has unverified inputs or an existing plan' using errcode='42501';
  end if;

  if source.research_pipeline_run_id is not null then
    select * into run from public.research_pipeline_runs
    where id=source.research_pipeline_run_id and organization_id=source.organization_id
      and project_id=source.project_id and requested_by=actor;
    if not found then raise exception 'linked research run is not accessible' using errcode='42501'; end if;
    return run.id;
  end if;

  select * into protocol from app_private.parse_fixed_chat_protocol(source.content);
  if not found then raise exception 'no eligible fixed research protocol' using errcode='22023'; end if;

  if protocol.template='ncbi_nucleotide_orf_v1' then
    run_id := public.request_research_nucleotide_pipeline(source.project_id,protocol.accession);
  elsif protocol.template='ncbi_protein_profile_v1' then
    run_id := public.request_research_protein_pipeline(source.project_id,protocol.accession);
  else
    raise exception 'unsupported fixed research protocol' using errcode='22023';
  end if;
  select * into run from public.research_pipeline_runs
    where id=run_id and organization_id=source.organization_id
      and project_id=source.project_id and requested_by=actor
      and template=protocol.template and requested_accession=protocol.accession;
  if not found then raise exception 'pipeline scope mismatch' using errcode='42501'; end if;
  update public.ai_messages set research_pipeline_run_id=run.id
    where id=source.id and research_pipeline_run_id is null;
  if not found then raise exception 'failed to seal research link'; end if;
  return run.id;
end $$;
revoke all on function app_private.approve_chat_research_pipeline(uuid)
  from public,anon,authenticated,service_role;
grant execute on function app_private.approve_chat_research_pipeline(uuid)
  to authenticated;

create or replace function public.approve_chat_research_pipeline(message_id uuid)
returns uuid language sql security invoker set search_path=''
as $$ select app_private.approve_chat_research_pipeline(message_id); $$;
revoke all on function public.approve_chat_research_pipeline(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.approve_chat_research_pipeline(uuid)
  to authenticated;
