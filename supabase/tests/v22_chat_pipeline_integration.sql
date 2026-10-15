-- Science V22: transactional local database test, never production.
-- Exercises real actor-bound RPCs against disposable local Supabase only.
-- Scientific work is only enqueued inside the transaction, then rolled back.
begin;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at)
values
('a1000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','science-v22-a@localhost.invalid','',now()),
('a1000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','science-v22-b@localhost.invalid','',now());

insert into public.organizations (id,name,slug,created_by)
values
('a2000000-0000-4000-8000-000000000001','V22 local org A','v22-local-org-a','a1000000-0000-4000-8000-000000000001'),
('a2000000-0000-4000-8000-000000000002','V22 local org B','v22-local-org-b','a1000000-0000-4000-8000-000000000002');
insert into public.organization_members (organization_id,user_id,role)
values
('a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','owner'),
('a2000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000002','owner');
insert into public.projects (id,organization_id,name,created_by)
values
('a3000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001','V22 local project A','a1000000-0000-4000-8000-000000000001'),
('a3000000-0000-4000-8000-000000000002','a2000000-0000-4000-8000-000000000002','V22 local project B','a1000000-0000-4000-8000-000000000002');
insert into public.ai_conversations (id,organization_id,project_id,created_by,title,status)
values
('a4000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','V22 local A','active'),
('a4000000-0000-4000-8000-000000000002','a2000000-0000-4000-8000-000000000002','a3000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000002','V22 local B','active'),
('a4000000-0000-4000-8000-000000000003','a2000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','V22 archived','archived');
insert into public.ai_messages
 (id,conversation_id,organization_id,project_id,conversation_owner_id,role,content,protocol_input_scope)
values
('a5000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','user','Retrieve NM_000546.6 and run an ORF scan','text_only'),
('a5000000-0000-4000-8000-000000000002','a4000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','user','Retrieve NM_000546.6 and run an ORF scan',null),
('a5000000-0000-4000-8000-000000000003','a4000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','user','Retrieve NM_000546.6 and run an ORF scan','with_attachments'),
('a5000000-0000-4000-8000-000000000004','a4000000-0000-4000-8000-000000000002','a2000000-0000-4000-8000-000000000002','a3000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000002','user','Retrieve NM_000546.6 and run an ORF scan','text_only'),
('a5000000-0000-4000-8000-000000000005','a4000000-0000-4000-8000-000000000003','a2000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','user','Retrieve NM_000546.6 and run an ORF scan','text_only'),
('a5000000-0000-4000-8000-000000000006','a4000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','user','Explain an ORF scan of NM_000546.6','text_only'),
('a5000000-0000-4000-8000-000000000007','a4000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','user','Calculate protein properties for NP_000537.3',null);

-- Client B must not approve another researcher's saved chat message.
set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000002',true);
select pg_catalog.set_config('request.jwt.claim.role','authenticated',true);
do $foreign$
begin
  begin
    perform public.approve_chat_research_pipeline('a5000000-0000-4000-8000-000000000001');
    raise exception 'cross-user approval unexpectedly succeeded';
  exception when sqlstate 'P0002' then null;
  end;
  if exists (select 1 from public.ai_messages where id='a5000000-0000-4000-8000-000000000001') then
    raise exception 'foreign message was visible to another user';
  end if;
end
$foreign$;
reset role;

-- Client A must not approve old, media-bound, archived or explanatory text.
set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000001',true);
select pg_catalog.set_config('request.jwt.claim.role','authenticated',true);
do $rejected$
declare candidate uuid; error_code text;
begin
  foreach candidate in array array[
    'a5000000-0000-4000-8000-000000000002'::uuid,
    'a5000000-0000-4000-8000-000000000003'::uuid,
    'a5000000-0000-4000-8000-000000000005'::uuid,
    'a5000000-0000-4000-8000-000000000006'::uuid,
    'a5000000-0000-4000-8000-000000000007'::uuid
  ] loop
    error_code := null;
    begin
      perform public.approve_chat_research_pipeline(candidate);
    exception when others then error_code := sqlstate; end;
    if error_code is null then raise exception 'ineligible message approved: %',candidate; end if;
  end loop;
  if (select count(*) from public.research_pipeline_runs where requested_by=auth.uid())<>0 then
    raise exception 'negative approval incorrectly launched research';
  end if;
end
$rejected$;

-- Genuine research approval persists a scoped run and re-approval reuses it.
do $approved$
declare first_id uuid; second_id uuid;
begin
  first_id := public.approve_chat_research_pipeline('a5000000-0000-4000-8000-000000000001');
  second_id := public.approve_chat_research_pipeline('a5000000-0000-4000-8000-000000000001');
  if first_id is null or first_id is distinct from second_id then
    raise exception 'approval did not persist idempotent run linkage';
  end if;
  if not exists (
    select 1 from public.ai_messages m
      join public.research_pipeline_runs r on m.research_pipeline_run_id=r.id
    where m.id='a5000000-0000-4000-8000-000000000001'
      and r.id=first_id and r.project_id=m.project_id
      and r.organization_id=m.organization_id and r.requested_by=auth.uid()
      and r.template='ncbi_nucleotide_orf_v1' and r.requested_accession='NM_000546.6'
  ) then raise exception 'approved run was not sealed to the original user message'; end if;
  if (select count(*) from public.research_pipeline_runs
       where project_id='a3000000-0000-4000-8000-000000000001')<>1 then
    raise exception 'duplicate approval created extra pipeline';
  end if;
end
$approved$;
reset role;

-- Even a privileged maintenance mistake cannot attach an unrelated or
-- unverified message to an existing pipeline: constraints fail closed.
do $scoped_link$
declare run_id uuid;
begin
  select research_pipeline_run_id into run_id
  from public.ai_messages
  where id='a5000000-0000-4000-8000-000000000001';
  if run_id is null then raise exception 'test run missing'; end if;

  begin
    update public.ai_messages set research_pipeline_run_id=run_id
    where id='a5000000-0000-4000-8000-000000000004';
    raise exception 'cross-tenant research link incorrectly accepted';
  exception when foreign_key_violation then null;
  end;

  begin
    update public.ai_messages set research_pipeline_run_id=run_id
    where id='a5000000-0000-4000-8000-000000000003';
    raise exception 'media-attached research link incorrectly accepted';
  exception when check_violation then null;
  end;

  begin
    update public.ai_messages set research_pipeline_run_id=run_id
    where id='a5000000-0000-4000-8000-000000000002';
    raise exception 'unverified historical research link incorrectly accepted';
  exception when check_violation then null;
  end;
end
$scoped_link$;

-- Service-only attestation must distinguish media from plain text.
insert into public.ai_messages
 (id,conversation_id,organization_id,project_id,conversation_owner_id,role,content)
values
('a5000000-0000-4000-8000-000000000008','a4000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','user','Calculate protein properties for NP_000537.3'),
('a5000000-0000-4000-8000-000000000009','a4000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','user','Calculate protein properties for NP_000537.3');
set local role service_role;
select public.mark_chat_protocol_input_scope(
 'a5000000-0000-4000-8000-000000000008','a1000000-0000-4000-8000-000000000001',false);
select public.mark_chat_protocol_input_scope(
 'a5000000-0000-4000-8000-000000000009','a1000000-0000-4000-8000-000000000001',true);
reset role;

do $attested$
begin
  if (select protocol_input_scope from public.ai_messages
      where id='a5000000-0000-4000-8000-000000000008') <> 'text_only'
    or (select protocol_input_scope from public.ai_messages
      where id='a5000000-0000-4000-8000-000000000009') <> 'with_attachments'
    then raise exception 'trusted media attestation failed'; end if;
end
$attested$;

rollback;
