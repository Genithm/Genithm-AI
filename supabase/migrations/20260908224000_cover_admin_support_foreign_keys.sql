create index platform_admins_granted_by_fk_idx
  on app_private.platform_admins (granted_by)
  where granted_by is not null;

create index platform_support_cases_opened_by_fk_idx
  on app_private.platform_support_cases (opened_by);

create index platform_support_cases_resolved_by_fk_idx
  on app_private.platform_support_cases (resolved_by)
  where resolved_by is not null;

create index platform_support_cases_target_project_fk_idx
  on app_private.platform_support_cases (target_project_id)
  where target_project_id is not null;
