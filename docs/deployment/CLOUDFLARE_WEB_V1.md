# Genithm V1 Web on Cloudflare Workers

Genithm V1 targets Cloudflare Workers for the Next.js frontend so the web tier can remain on Cloudflare's Free plan while usage stays within Free-plan limits.

## Architecture

```text
Browser
  -> Cloudflare Workers (Next.js web)
      -> Supabase Auth / Postgres
      -> api.<domain> through Cloudflare Tunnel
          -> Oracle API
              -> Supabase + R2 + six Oracle workers
```

The web application is built with Next.js 16 and transformed for the Workers runtime with `@opennextjs/cloudflare`. The Oracle API remains separate and is not moved into Workers.

## Repository contract

- App root: `apps/web`
- Next.js build: `npm run build`
- Cloudflare build: `npm run cf:build`
- Local Workers preview: `npm run cf:preview`
- Production deploy: `npm run cf:deploy`
- Worker config: `apps/web/wrangler.jsonc`
- Generated output: `apps/web/.open-next/` (never commit)
- Session refresh runs through `middleware.ts`; the Next.js 16 Node `proxy.ts` path is intentionally not used because OpenNext Cloudflare does not yet support Node Middleware.

Cloudflare/OpenNext tooling is invoked with exact versions from package scripts so the existing application lockfile remains unchanged. Do not replace the pinned versions during a release candidate without running the Cloudflare web contract and normal CI again.

## Production variables

Configure these in the Cloudflare Worker settings. Never commit real values.

```text
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
GENITHM_APP_URL=https://<web-domain>
```

Only publishable Supabase values may use the `NEXT_PUBLIC_` prefix. Supabase secret/service-role keys, R2 credentials, AI provider keys, payment-provider secrets, Oracle credentials, and Cloudflare Tunnel tokens must never be configured in the browser-facing web bundle.

For local Workers preview, copy `apps/web/.dev.vars.example` to `apps/web/.dev.vars` and replace placeholders locally.

## Cloudflare account setup

1. Create or select the Cloudflare account/zone that will serve the Genithm web domain.
2. Create a Workers application named `genithm-web`.
3. Connect the GitHub repository or deploy from an authenticated Wrangler session.
4. Use `apps/web` as the application working directory.
5. Configure the three production variables above.
6. Build the exact revision intended for release with `npm ci && npm run cf:build`.
7. Deploy with `npm run cf:deploy`, or configure the connected repository to deploy the same build output.
8. Attach the production custom domain only after the deployed Worker passes the web health and authentication smoke checks.

## Required validation before V1 tag

The `.github/workflows/cloudflare-web-contract.yml` workflow must pass on the release revision. It verifies:

- locked application dependencies install successfully;
- TypeScript type checking succeeds;
- the normal Next.js build can be transformed by OpenNext;
- `.open-next/worker.js` and static assets are generated;
- the supported `middleware.ts` path is present and `proxy.ts` is absent;
- Wrangler enables the required `nodejs_compat` flag.

At the real Cloudflare deployment, verify the final compressed Worker bundle stays within the current Free-plan Worker size limit. If it exceeds the Free limit, do not silently move to a paid plan; treat that as a release blocker and optimize/split the frontend first.

## Production smoke

After the custom domain is attached:

1. `GET /api/health` on the web origin returns the exact Genithm web health contract.
2. Login/session refresh works through middleware.
3. Dashboard routes render without runtime compatibility errors.
4. Browser requests reach the Oracle API only through the configured HTTPS API hostname.
5. No server-only credential appears in the browser bundle or response payloads.
6. Run the normal production smoke and scientific E2E gates before creating `v1.0.0`.

## Rollback

Cloudflare keeps Worker versions/deployments. If the V1 deployment fails smoke checks, roll traffic back to the previously verified Worker version and keep the failed candidate untagged. Do not mutate the immutable Oracle API/worker image references during a web-only rollback.
