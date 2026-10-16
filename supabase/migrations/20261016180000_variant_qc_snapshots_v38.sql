-- Genithm V38: optional storage of aggregate-only, locally computed VCF QC.
-- No raw VCF, genotype calls, sample IDs or variant-level records are persisted.
-- Browser-computed metrics and SHA must never be treated as server-verified data.
create table public.variant_qc_snapshots (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete restrict,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  created_by uuid not null references auth.users(id) on delete restrict,
  title text not null check (char_length(btrim(title)) between 3 and 160),
  source_sha256 text not null check (source_sha256 ~ '^[a-f0-9]{64}$'),
  analyzer_version text not null default 'genithm-vcf-qc/1.0.0'
    check (analyzer_version='genithm-vcf-qc/1.0.0'),
  total_records integer not null check (total_records between 1 and 50000),
  summary jsonb not null check (jsonb_typeof(summary)='object' and
    pg_column_size(summary) <= 16000),
  source_verification text not null default 'client_computed_unverified'
    check (source_verification='client_computed_unverified'),
  created_at timestamptz not null default now()
);
create index variant_qc_snapshots_owner_recent_idx
  on public.variant_qc_snapshots(created_by,created_at desc);
create index variant_qc_snapshots_project_recent_idx
  on public.variant_qc_snapshots(project_id,created_at desc);

create function app_private.guard_variant_qc_snapshot()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  actor uuid := auth.uid();
  org uuid;
begin
  if actor is null or new.created_by is distinct from actor then
    raise exception 'Invalid QC snapshot owner' using errcode='42501';
  end if;
  select p.organization_id into org from public.projects p
    where p.id=new.project_id and p.status='active'
      and app_private.is_org_member(p.organization_id);
  if not found then
    raise exception 'Project unavailable' using errcode='42501';
  end if;
  new.organization_id := org;
  -- This checks aggregate metadata consistency, not uploaded biological input.
  if new.summary->>'schema' is distinct from 'genithm-vcf-qc-summary/1'
     or new.summary->>'analyzerVersion' is distinct from new.analyzer_version
     or new.summary->>'totalRecords' is distinct from new.total_records::text
     or (new.summary - array[
       'schema','analyzerVersion','totalRecords','sampleColumns','variantCounts',
       'filterCounts','qualityBins','missingQual','transitions','transversions',
       'chromCounts','distinctChromosomes'
     ]::text[]) <> '{}'::jsonb
     or jsonb_typeof(new.summary->'variantCounts') is distinct from 'object'
     or jsonb_typeof(new.summary->'filterCounts') is distinct from 'object'
     or jsonb_typeof(new.summary->'qualityBins') is distinct from 'array'
     or (case when jsonb_typeof(new.summary->'qualityBins')='array'
       then jsonb_array_length(new.summary->'qualityBins') else -1 end) <> 7
     or jsonb_typeof(new.summary->'chromCounts') is distinct from 'array'
     or (case when jsonb_typeof(new.summary->'chromCounts')='array'
       then jsonb_array_length(new.summary->'chromCounts') else -1 end) not between 1 and 12
     or (new.summary->'variantCounts' - array[
       'SNV','MNV','insertion','deletion','complex','multiallelic'
     ]::text[]) <> '{}'::jsonb
     or (new.summary->'filterCounts' - array[
       'pass','filtered','missing'
     ]::text[]) <> '{}'::jsonb
  then
    raise exception 'VCF QC summary metadata is inconsistent' using errcode='23514';
  end if;
  new.source_verification := 'client_computed_unverified';
  new.created_at := now();
  return new;
end $$;
revoke all on function app_private.guard_variant_qc_snapshot()
  from public,anon,authenticated,service_role;
create trigger variant_qc_snapshot_insert_guard
  before insert on public.variant_qc_snapshots
  for each row execute function app_private.guard_variant_qc_snapshot();

alter table public.variant_qc_snapshots enable row level security;
create policy variant_qc_snapshots_select_owner
  on public.variant_qc_snapshots for select to authenticated
  using (created_by=(select auth.uid()) and
    (select app_private.is_org_member(organization_id)));
create policy variant_qc_snapshots_insert_owner
  on public.variant_qc_snapshots for insert to authenticated
  with check (created_by=(select auth.uid()) and
    (select app_private.is_org_member(organization_id)));
create policy variant_qc_snapshots_delete_owner
  on public.variant_qc_snapshots for delete to authenticated
  using (created_by=(select auth.uid()) and
    (select app_private.is_org_member(organization_id)));
revoke all on public.variant_qc_snapshots from public, anon;
grant select,insert,delete on public.variant_qc_snapshots to authenticated;
comment on table public.variant_qc_snapshots is
  'Optional project-scoped aggregate VCF QC summaries only. Locally computed source SHA is NOT server verified; no raw VCF, variant calls or genotype data are stored.';
