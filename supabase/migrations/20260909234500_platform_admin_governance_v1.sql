-- Platform Admin Governance V1
-- Audited, MFA-gated management of platform-admin entitlements after first-admin bootstrap.

create table app_private.platform_admin_governance_chain_head (
  singleton boolean primary key default true,
  last_sequence bigint not null default 0,
  last_hash text not null default repeat('0', 64),
  updated_at timestamptz not null default now(),
  constraint platform_admin_governance_chain_head_singleton check (singleton),
  constraint platform_admin_governance_chain_head_sequence check (last_sequence >= 0),
  constraint platform_admin_governance_chain_head_hash check (last_hash ~ '^[0-9a-f]{64}$')
);

insert into app_private.platform_admin_governance_chain_head (singleton)
values (true)
on conflict (singleton) do nothing;

alter table app_private.platform_admin_governance_chain_head enable row level security;
alter table app_private.platform_admin_governance_chain_head force row level security;
revoke all on table app_private.platform_admin_governance_chain_head from public, anon, authenticated, service_role;

create policy platform_admin_governance_chain_head_explicit_deny
on app_private.platform_admin_governance_chain_head
as restrictive
for all
to public
using (false)
with check (false);

create table app_private.platform_admin_governance_events (
  event_id uuid primary key,
  chain_sequence bigint not null unique,
  action text not null,
  target_user_id uuid not null,
  actor_user_id uuid not null,
  reason text not null,
  occurred_at timestamptz not null,
  previous_hash text not null,
  event_hash text not null unique,
  constraint platform_admin_governance_events_action check (action in ('grant','revoke')),
  constraint platform_admin_governance_events_reason_length check (char_length(reason) between 3 and 500),
  constraint platform_admin_governance_events_sequence check (chain_sequence > 0),
  constraint platform_admin_governance_events_previous_hash check (previous_hash ~ '^[0-9a-f]{64}$'),
  constraint platform_admin_governance_events_event_hash check (event_hash ~ '^[0-9a-f]{64}$')
);

create index platform_admin_governance_events_target_idx
  on app_private.platform_admin_governance_events (target_user_id, occurred_at desc);
create index platform_admin_governance_events_actor_idx
  on app_private.platform_admin_governance_events (actor_user_id, occurred_at desc);

alter table app_private.platform_admin_governance_events enable row level security;
alter table app_private.platform_admin_governance_events force row level security;
revoke all on table app_private.platform_admin_governance_events from public, anon, authenticated, service_role;

create policy platform_admin_governance_events_explicit_deny
on app_private.platform_admin_governance_events
as restrictive
for all
to public
using (false)
with check (false);

create or replace function app_private.compute_platform_admin_governance_hash(
  p_event_id uuid,
  p_chain_sequence bigint,
  p_action text,
  p_target_user_id uuid,
  p_actor_user_id uuid,
  p_reason text,
  p_occurred_at timestamptz,
  p_previous_hash text
)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(
    extensions.digest(
      convert_to(
        concat_ws(
          E'\x1f',
          'platform-admin-governance-sha256-v1',
          p_event_id::text,
          p_chain_sequence::text,
          p_action,
          p_target_user_id::text,
          p_actor_user_id::text,
          p_reason,
          extract(epoch from p_occurred_at)::text,
          p_previous_hash
        ),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$$;

revoke all on function app_private.compute_platform_admin_governance_hash(uuid,bigint,text,uuid,uuid,text,timestamptz,text)
from public, anon, authenticated, service_role;

create or replace function app_private.append_platform_admin_governance_event(
  p_action text,
  p_target_user_id uuid,
  p_actor_user_id uuid,
  p_reason text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  event_id uuid := gen_random_uuid();
  event_time timestamptz := clock_timestamp();
  prior_sequence bigint;
  prior_hash text;
  next_sequence bigint;
  calculated_hash text;
begin
  if p_action not in ('grant','revoke') then
    raise exception 'invalid platform admin governance action' using errcode = '22023';
  end if;

  if p_target_user_id is null or p_actor_user_id is null then
    raise exception 'platform admin governance identities are required' using errcode = '22023';
  end if;

  if char_length(p_reason) < 3 or char_length(p_reason) > 500 then
    raise exception 'platform admin governance reason must be between 3 and 500 characters' using errcode = '22023';
  end if;

  select last_sequence, last_hash
    into prior_sequence, prior_hash
    from app_private.platform_admin_governance_chain_head
   where singleton = true
   for update;

  if not found then
    raise exception 'platform admin governance chain head is unavailable';
  end if;

  next_sequence := prior_sequence + 1;
  calculated_hash := app_private.compute_platform_admin_governance_hash(
    event_id,
    next_sequence,
    p_action,
    p_target_user_id,
    p_actor_user_id,
    p_reason,
    event_time,
    prior_hash
  );

  insert into app_private.platform_admin_governance_events (
    event_id,
    chain_sequence,
    action,
    target_user_id,
    actor_user_id,
    reason,
    occurred_at,
    previous_hash,
    event_hash
  ) values (
    event_id,
    next_sequence,
    p_action,
    p_target_user_id,
    p_actor_user_id,
    p_reason,
    event_time,
    prior_hash,
    calculated_hash
  );

  update app_private.platform_admin_governance_chain_head
     set last_sequence = next_sequence,
         last_hash = calculated_hash,
         updated_at = event_time
   where singleton = true;

  return event_id;
end;
$$;

revoke all on function app_private.append_platform_admin_governance_event(text,uuid,uuid,text)
from public, anon, authenticated, service_role;

create or replace function app_private.prevent_platform_admin_governance_event_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'platform admin governance events are append-only';
end;
$$;

revoke all on function app_private.prevent_platform_admin_governance_event_mutation()
from public, anon, authenticated, service_role;

create trigger platform_admin_governance_events_block_update_delete
before update or delete on app_private.platform_admin_governance_events
for each row execute function app_private.prevent_platform_admin_governance_event_mutation();

create or replace function app_private.lookup_platform_admin_candidate(p_exact_email text)
returns table (
  user_id uuid,
  email text,
  display_name text,
  email_confirmed_at timestamptz,
  has_verified_mfa boolean,
  is_platform_admin boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  normalized_email text := lower(trim(coalesce(p_exact_email, '')));
begin
  if not app_private.is_platform_admin() then
    raise exception 'platform admin access required' using errcode = '42501';
  end if;

  if char_length(normalized_email) < 3 or char_length(normalized_email) > 320 or normalized_email not like '%@%' then
    raise exception 'valid exact email is required' using errcode = '22023';
  end if;

  return query
  select
    account.id,
    account.email,
    profile.display_name,
    account.email_confirmed_at,
    exists (
      select 1
      from auth.mfa_factors as factor
      where factor.user_id = account.id
        and factor.status::text = 'verified'
    ),
    exists (
      select 1
      from app_private.platform_admins as platform_admin
      where platform_admin.user_id = account.id
        and platform_admin.role = 'platform_admin'
    )
  from auth.users as account
  left join public.profiles as profile on profile.id = account.id
  where lower(account.email) = normalized_email
  limit 1;
end;
$$;

revoke all on function app_private.lookup_platform_admin_candidate(text)
from public, anon, authenticated, service_role;
grant execute on function app_private.lookup_platform_admin_candidate(text) to authenticated;

create or replace function app_private.get_platform_admin_roster()
returns table (
  user_id uuid,
  email text,
  display_name text,
  granted_at timestamptz,
  granted_by uuid,
  reason text,
  has_verified_mfa boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app_private.is_platform_admin() then
    raise exception 'platform admin access required' using errcode = '42501';
  end if;

  return query
  select
    platform_admin.user_id,
    account.email,
    profile.display_name,
    platform_admin.granted_at,
    platform_admin.granted_by,
    platform_admin.reason,
    exists (
      select 1
      from auth.mfa_factors as factor
      where factor.user_id = platform_admin.user_id
        and factor.status::text = 'verified'
    )
  from app_private.platform_admins as platform_admin
  join auth.users as account on account.id = platform_admin.user_id
  left join public.profiles as profile on profile.id = platform_admin.user_id
  where platform_admin.role = 'platform_admin'
  order by platform_admin.granted_at, platform_admin.user_id
  limit 100;
end;
$$;

revoke all on function app_private.get_platform_admin_roster()
from public, anon, authenticated, service_role;
grant execute on function app_private.get_platform_admin_roster() to authenticated;

create or replace function app_private.get_platform_admin_governance_events(
  p_page_size integer,
  p_page_offset integer
)
returns table (
  event_id uuid,
  chain_sequence bigint,
  action text,
  target_user_id uuid,
  target_email text,
  actor_user_id uuid,
  actor_email text,
  reason text,
  occurred_at timestamptz,
  previous_hash text,
  event_hash text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app_private.is_platform_admin() then
    raise exception 'platform admin access required' using errcode = '42501';
  end if;

  if p_page_size < 1 or p_page_size > 100 then
    raise exception 'page size must be between 1 and 100' using errcode = '22023';
  end if;

  if p_page_offset < 0 then
    raise exception 'page offset must be non-negative' using errcode = '22023';
  end if;

  return query
  select
    governance_event.event_id,
    governance_event.chain_sequence,
    governance_event.action,
    governance_event.target_user_id,
    target_account.email,
    governance_event.actor_user_id,
    actor_account.email,
    governance_event.reason,
    governance_event.occurred_at,
    governance_event.previous_hash,
    governance_event.event_hash
  from app_private.platform_admin_governance_events as governance_event
  left join auth.users as target_account on target_account.id = governance_event.target_user_id
  left join auth.users as actor_account on actor_account.id = governance_event.actor_user_id
  order by governance_event.chain_sequence desc
  limit p_page_size
  offset p_page_offset;
end;
$$;

revoke all on function app_private.get_platform_admin_governance_events(integer,integer)
from public, anon, authenticated, service_role;
grant execute on function app_private.get_platform_admin_governance_events(integer,integer) to authenticated;

create or replace function app_private.verify_platform_admin_governance_chain()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  governance_event record;
  expected_sequence bigint := 1;
  expected_previous_hash text := repeat('0', 64);
  calculated_hash text;
  event_count bigint := 0;
  head_sequence bigint;
  head_hash text;
begin
  if not app_private.is_platform_admin() then
    raise exception 'platform admin access required' using errcode = '42501';
  end if;

  for governance_event in
    select *
    from app_private.platform_admin_governance_events
    order by chain_sequence
  loop
    calculated_hash := app_private.compute_platform_admin_governance_hash(
      governance_event.event_id,
      governance_event.chain_sequence,
      governance_event.action,
      governance_event.target_user_id,
      governance_event.actor_user_id,
      governance_event.reason,
      governance_event.occurred_at,
      governance_event.previous_hash
    );

    if governance_event.chain_sequence <> expected_sequence
       or governance_event.previous_hash <> expected_previous_hash
       or governance_event.event_hash <> calculated_hash then
      return jsonb_build_object(
        'valid', false,
        'event_count', event_count,
        'failed_sequence', governance_event.chain_sequence,
        'chain_version', 'platform-admin-governance-sha256-v1'
      );
    end if;

    event_count := event_count + 1;
    expected_sequence := expected_sequence + 1;
    expected_previous_hash := governance_event.event_hash;
  end loop;

  select last_sequence, last_hash
    into head_sequence, head_hash
    from app_private.platform_admin_governance_chain_head
   where singleton = true;

  return jsonb_build_object(
    'valid', head_sequence = event_count and head_hash = expected_previous_hash,
    'event_count', event_count,
    'head_sequence', head_sequence,
    'head_hash', head_hash,
    'chain_version', 'platform-admin-governance-sha256-v1'
  );
end;
$$;

revoke all on function app_private.verify_platform_admin_governance_chain()
from public, anon, authenticated, service_role;
grant execute on function app_private.verify_platform_admin_governance_chain() to authenticated;

create or replace function app_private.grant_platform_admin(
  p_target_user_id uuid,
  p_reason text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller_id uuid := app_private.require_platform_admin_aal2();
  normalized_reason text := trim(coalesce(p_reason, ''));
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('genithm-platform-admin-governance-v1', 0)
  );

  if p_target_user_id is null then
    raise exception 'target user id is required' using errcode = '22023';
  end if;

  if char_length(normalized_reason) < 3 or char_length(normalized_reason) > 500 then
    raise exception 'grant reason must be between 3 and 500 characters' using errcode = '22023';
  end if;

  if exists (
    select 1
    from app_private.platform_admins as platform_admin
    where platform_admin.user_id = p_target_user_id
      and platform_admin.role = 'platform_admin'
  ) then
    raise exception 'target user is already a platform admin' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from auth.users as account
    where account.id = p_target_user_id
      and account.email_confirmed_at is not null
  ) then
    raise exception 'confirmed target user was not found' using errcode = 'P0002';
  end if;

  if not exists (
    select 1
    from auth.mfa_factors as factor
    where factor.user_id = p_target_user_id
      and factor.status::text = 'verified'
  ) then
    raise exception 'target user must have a verified MFA factor before platform admin grant' using errcode = '42501';
  end if;

  insert into app_private.platform_admins (
    user_id,
    role,
    granted_at,
    granted_by,
    reason
  ) values (
    p_target_user_id,
    'platform_admin',
    now(),
    caller_id,
    normalized_reason
  );

  perform app_private.append_platform_admin_governance_event(
    'grant',
    p_target_user_id,
    caller_id,
    normalized_reason
  );

  return p_target_user_id;
end;
$$;

revoke all on function app_private.grant_platform_admin(uuid,text)
from public, anon, authenticated, service_role;
grant execute on function app_private.grant_platform_admin(uuid,text) to authenticated;

create or replace function app_private.revoke_platform_admin(
  p_target_user_id uuid,
  p_reason text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller_id uuid := app_private.require_platform_admin_aal2();
  normalized_reason text := trim(coalesce(p_reason, ''));
  admin_count bigint;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('genithm-platform-admin-governance-v1', 0)
  );

  if p_target_user_id is null then
    raise exception 'target user id is required' using errcode = '22023';
  end if;

  if char_length(normalized_reason) < 3 or char_length(normalized_reason) > 500 then
    raise exception 'revocation reason must be between 3 and 500 characters' using errcode = '22023';
  end if;

  if p_target_user_id = caller_id then
    raise exception 'platform admins cannot revoke their own entitlement' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from app_private.platform_admins as platform_admin
    where platform_admin.user_id = p_target_user_id
      and platform_admin.role = 'platform_admin'
  ) then
    raise exception 'target user is not a platform admin' using errcode = 'P0002';
  end if;

  select count(*) into admin_count
  from app_private.platform_admins
  where role = 'platform_admin';

  if admin_count <= 1 then
    raise exception 'the final platform admin cannot be revoked' using errcode = '42501';
  end if;

  delete from app_private.platform_admins
  where user_id = p_target_user_id
    and role = 'platform_admin';

  perform app_private.append_platform_admin_governance_event(
    'revoke',
    p_target_user_id,
    caller_id,
    normalized_reason
  );

  return p_target_user_id;
end;
$$;

revoke all on function app_private.revoke_platform_admin(uuid,text)
from public, anon, authenticated, service_role;
grant execute on function app_private.revoke_platform_admin(uuid,text) to authenticated;

create or replace function public.lookup_platform_admin_candidate(exact_email text)
returns table (
  user_id uuid,
  email text,
  display_name text,
  email_confirmed_at timestamptz,
  has_verified_mfa boolean,
  is_platform_admin boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from app_private.lookup_platform_admin_candidate(exact_email);
$$;

create or replace function public.get_platform_admin_roster()
returns table (
  user_id uuid,
  email text,
  display_name text,
  granted_at timestamptz,
  granted_by uuid,
  reason text,
  has_verified_mfa boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from app_private.get_platform_admin_roster();
$$;

create or replace function public.get_platform_admin_governance_events(
  page_size integer default 50,
  page_offset integer default 0
)
returns table (
  event_id uuid,
  chain_sequence bigint,
  action text,
  target_user_id uuid,
  target_email text,
  actor_user_id uuid,
  actor_email text,
  reason text,
  occurred_at timestamptz,
  previous_hash text,
  event_hash text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from app_private.get_platform_admin_governance_events(page_size, page_offset);
$$;

create or replace function public.verify_platform_admin_governance_chain()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select app_private.verify_platform_admin_governance_chain();
$$;

create or replace function public.grant_platform_admin(
  target_user_id uuid,
  reason text
)
returns uuid
language sql
volatile
security invoker
set search_path = ''
as $$
  select app_private.grant_platform_admin(target_user_id, reason);
$$;

create or replace function public.revoke_platform_admin(
  target_user_id uuid,
  reason text
)
returns uuid
language sql
volatile
security invoker
set search_path = ''
as $$
  select app_private.revoke_platform_admin(target_user_id, reason);
$$;

revoke all on function public.lookup_platform_admin_candidate(text)
from public, anon, authenticated, service_role;
revoke all on function public.get_platform_admin_roster()
from public, anon, authenticated, service_role;
revoke all on function public.get_platform_admin_governance_events(integer,integer)
from public, anon, authenticated, service_role;
revoke all on function public.verify_platform_admin_governance_chain()
from public, anon, authenticated, service_role;
revoke all on function public.grant_platform_admin(uuid,text)
from public, anon, authenticated, service_role;
revoke all on function public.revoke_platform_admin(uuid,text)
from public, anon, authenticated, service_role;

grant execute on function public.lookup_platform_admin_candidate(text) to authenticated;
grant execute on function public.get_platform_admin_roster() to authenticated;
grant execute on function public.get_platform_admin_governance_events(integer,integer) to authenticated;
grant execute on function public.verify_platform_admin_governance_chain() to authenticated;
grant execute on function public.grant_platform_admin(uuid,text) to authenticated;
grant execute on function public.revoke_platform_admin(uuid,text) to authenticated;

comment on table app_private.platform_admin_governance_events is
  'Append-only, SHA-256 hash-chained global audit history for platform-admin entitlement grants and revocations.';

comment on function public.grant_platform_admin(uuid,text) is
  'Platform-admin-only AAL2 mutation. Target must be confirmed and have a verified MFA factor before elevation.';

comment on function public.revoke_platform_admin(uuid,text) is
  'Platform-admin-only AAL2 mutation. Self-revocation and removal of the final platform admin are prohibited.';
