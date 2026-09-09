# Platform Admin Provisioning V1

Platform Admin Provisioning V1 closes the initial activation gap without introducing a browser self-grant path.

## Security model

The first Platform Admin is activated only after all of these conditions are true:

1. the operator has created and confirmed a normal Genithm Auth account;
2. the deployment's server-only `GENITHM_BOOTSTRAP_ADMIN_USER_ID` equals that account UUID;
3. the account has a verified MFA factor;
4. the current session is authenticated at `aal2`;
5. the database still contains zero Platform Admins.

The browser cannot select a target user and cannot call the bootstrap RPC. The public RPC wrapper is executable only by `service_role`; the privileged implementation remains in `app_private` with `security definer` and `search_path=''`.

Once any Platform Admin exists, the one-time bootstrap rejects a different target. Repeating activation for the already-provisioned target is idempotent.

## Activation flow

1. Create the intended operator account through the normal `/login` sign-up flow and confirm its email.
2. Read the new user's UUID from the trusted Supabase operator surface.
3. Set `GENITHM_BOOTSTRAP_ADMIN_USER_ID` in the server/deployment environment. Never prefix this value with `NEXT_PUBLIC_`.
4. Sign in as that exact account and open `/admin/bootstrap`.
5. If no TOTP factor exists, select **Set up authenticator**, scan the QR code, and verify the 6-digit code.
6. If a verified factor already exists but the session is `aal1`, enter the current authenticator code to upgrade the session.
7. When the page shows `aal2`, select **Activate first platform admin**.
8. The server revalidates the account UUID and AAL2 state, then calls the service-role-only database bootstrap.
9. Successful activation redirects to `/dashboard/admin`.

Supabase's TOTP verification promotes the current session to AAL2. Database-side activation also independently requires that the target account has at least one verified MFA factor.

## What this flow does not do

- It does not auto-promote the first signup.
- It does not trust email addresses, profile metadata, `user_metadata`, or organization roles for authorization.
- It does not expose the Supabase secret/service-role key to the browser.
- It does not add a general-purpose grant/revoke Platform Admin RPC.
- It does not create users automatically.
- It does not bypass MFA.

## After bootstrap

`GENITHM_BOOTSTRAP_ADMIN_USER_ID` may remain configured because the database bootstrap is permanently closed to any different target once an admin exists. Operationally, removing the variable after successful activation further reduces unnecessary bootstrap surface.

Future Platform Admin grants should use a separately designed, audited multi-admin governance flow rather than reopening this first-admin bootstrap.
