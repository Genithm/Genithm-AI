create policy audit_checkpoint_requests_deny_all
on app_private.audit_checkpoint_requests
as restrictive
for all
to public
using (false)
with check (false);
