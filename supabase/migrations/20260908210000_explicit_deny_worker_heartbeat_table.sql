create policy worker_runtime_heartbeats_deny_all
on app_private.worker_runtime_heartbeats
as restrictive
for all
to public
using (false)
with check (false);

comment on policy worker_runtime_heartbeats_deny_all on app_private.worker_runtime_heartbeats is
  'Explicit deny-all policy. Worker heartbeat access is available only through narrowly granted service-role RPCs.';
