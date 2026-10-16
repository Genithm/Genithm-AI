-- Genithm V39: optional aggregate-only, privacy-preserving FASTQ QC snapshots.
-- NEVER persist raw reads, read identifiers, per-read values, FASTQ contents or
-- individual sample names. Browser-computed hashes are NOT server-verification.
create table public.fastq_qc_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  project_id uuid not null references public.projects(id) on delete restrict,
  created_by uuid not null references auth.users(id) on delete restrict,
  title text not null check(char_length(btrim(title)) between 3 and 160),
  mode text not null check(mode in ('single','paired')),
  read_count integer not null check(read_count between 1 and 100000),
  source_hashes text[] not null check(cardinality(source_hashes) between 1 and 2 and
    array_position(source_hashes,null) is null),
  summary jsonb not null check(jsonb_typeof(summary)='object' and pg_column_size(summary)<=130000),
  analyzer_version text not null default 'genithm-fastq-qc/1.0.0'
    check(analyzer_version='genithm-fastq-qc/1.0.0'),
  source_verification text not null default 'client_computed_unverified'
    check(source_verification='client_computed_unverified'),
  created_at timestamptz not null default now()
);
create index fastq_qc_snapshots_owner_recent_idx on public.fastq_qc_snapshots(created_by,created_at desc);
create index fastq_qc_snapshots_project_recent_idx on public.fastq_qc_snapshots(project_id,created_at desc);

create function app_private.guard_fastq_qc_snapshot()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  actor uuid:=auth.uid();
  org uuid;
  expected_count integer;
  item jsonb;
  hash text;
begin
  if actor is null or new.created_by is distinct from actor then
    raise exception 'Invalid FASTQ QC snapshot owner' using errcode='42501';
  end if;
  select p.organization_id into org from public.projects p
    where p.id=new.project_id and p.status='active'
      and app_private.is_org_member(p.organization_id);
  if not found then raise exception 'Project unavailable' using errcode='42501'; end if;
  new.organization_id:=org;
  expected_count:=case new.mode when 'paired' then 2 else 1 end;
  if cardinality(new.source_hashes)<>expected_count or
     exists(select 1 from unnest(new.source_hashes) as h where h!~'^[a-f0-9]{64}$') or
     new.summary->>'schema' is distinct from 'genithm-fastq-qc-summary/1' or
     new.summary->>'analyzerVersion' is distinct from new.analyzer_version or
     new.summary->>'mode' is distinct from new.mode or
     new.summary->>'encoding' is distinct from 'phred33' or
     new.summary->>'matesChecked' is distinct from
       (case when new.mode='paired' then 'true' else 'false' end) or
     (new.summary-array['schema','analyzerVersion','mode','encoding','matesChecked','reads']::text[])
       <> '{}'::jsonb or
     jsonb_typeof(new.summary->'reads') is distinct from 'array' or
     (case when jsonb_typeof(new.summary->'reads')='array'
       then jsonb_array_length(new.summary->'reads') else -1 end)<>expected_count
  then raise exception 'Malformed aggregate FASTQ QC summary' using errcode='23514'; end if;
  for item in select value from jsonb_array_elements(new.summary->'reads') loop
    if jsonb_typeof(item) is distinct from 'object' or
       (item-array['readCount','baseCount','minLength','maxLength','meanLength',
         'meanPhred','gcPercent','nPercent','q20BaseCount','q30BaseCount',
         'baseCounts','lengthBands','qualityBands','perCycle']::text[]) <> '{}'::jsonb or
       item->>'readCount' is distinct from new.read_count::text or
       jsonb_typeof(item->'baseCounts') is distinct from 'object' or
       (item->'baseCounts'-array['A','C','G','T','N']::text[]) <> '{}'::jsonb or
       jsonb_typeof(item->'lengthBands') is distinct from 'array' or
       jsonb_typeof(item->'qualityBands') is distinct from 'array' or
       jsonb_typeof(item->'perCycle') is distinct from 'array' or
       (case when jsonb_typeof(item->'lengthBands')='array'
          then jsonb_array_length(item->'lengthBands') else -1 end)<>7 or
       (case when jsonb_typeof(item->'qualityBands')='array'
          then jsonb_array_length(item->'qualityBands') else -1 end)<>5 or
       (case when jsonb_typeof(item->'perCycle')='array'
          then jsonb_array_length(item->'perCycle') else -1 end) not between 1 and 400
    then raise exception 'Unexpected FASTQ per-read or raw payload data'
      using errcode='23514'; end if;
  end loop;
  new.source_verification:='client_computed_unverified';
  new.created_at:=now();
  return new;
end $$;
revoke all on function app_private.guard_fastq_qc_snapshot()
  from public,anon,authenticated,service_role;
create trigger fastq_qc_snapshot_guard
  before insert on public.fastq_qc_snapshots
  for each row execute function app_private.guard_fastq_qc_snapshot();

alter table public.fastq_qc_snapshots enable row level security;
create policy fastq_qc_select_owner on public.fastq_qc_snapshots for select to authenticated
  using(created_by=(select auth.uid()) and (select app_private.is_org_member(organization_id)));
create policy fastq_qc_insert_owner on public.fastq_qc_snapshots for insert to authenticated
  with check(created_by=(select auth.uid()) and (select app_private.is_org_member(organization_id)));
create policy fastq_qc_delete_owner on public.fastq_qc_snapshots for delete to authenticated
  using(created_by=(select auth.uid()) and (select app_private.is_org_member(organization_id)));
revoke all on public.fastq_qc_snapshots from public,anon;
grant select,insert,delete on public.fastq_qc_snapshots to authenticated;
comment on table public.fastq_qc_snapshots is
  'Aggregate-only FASTQ QC (single or paired). Local client hashes are unverified, raw reads and identifiers never stored.';
