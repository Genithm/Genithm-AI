# Genithm V1 Production Scientific E2E

This runbook validates a real production scientific journey after the web, API, R2 Storage Gateway, Supabase schema, queues, and all six workers are deployed.

## Release gate

A production release is not considered end-to-end validated until this harness passes from an authorized deployment environment.

The harness uses browser-equivalent permissions. It authenticates as a dedicated non-admin test user with the Supabase publishable key. It must not use the Supabase secret/service-role key.

Validated journey:

1. Password authentication for the dedicated release-test user.
2. Organization creation through the public authenticated RPC.
3. Project creation through authenticated RLS-protected table access.
4. Two small private FASTA reservations through the Genithm Storage Gateway.
5. Direct upload to short-lived Cloudflare R2 presigned URLs.
6. Server-side upload verification and queueing.
7. Sequence-worker deterministic validation and provenance.
8. Pairwise alignment request through the public authenticated RPC.
9. Scientific-worker execution.
10. Completed scientific result with result hash, tool version, executor version, summary, and provenance.

## Prerequisites

Before running this E2E, the secretless production smoke gate must pass. In particular:

- API `/api/v1/health` is healthy.
- API `/api/v1/ready` reports exactly six expected workers and nine expected queues with no missing/stale workers or queues.
- Web `/api/health` is healthy.
- R2 Storage Gateway configuration is active on the API.
- The worker host can read the R2 sequence bucket.

Create a dedicated production release-test user through the normal authorized account-management process. Do not reuse a platform-admin account.

## Runtime environment

Set these variables only in the authorized deployment shell or secret manager session used to execute the release test:

```text
GENITHM_E2E_SUPABASE_URL=https://<project>.supabase.co
GENITHM_E2E_SUPABASE_PUBLISHABLE_KEY=<publishable-key>
GENITHM_E2E_API_BASE_URL=https://api.<production-domain>
GENITHM_E2E_EMAIL=<dedicated-release-test-user>
GENITHM_E2E_PASSWORD=<runtime-secret>
```

The script intentionally has no service-role credential input.

Do not paste the password into source files, GitHub Actions workflow inputs, issue comments, pull requests, command history shared with others, or application logs.

## Execute

From the exact deployed release checkout:

```text
python scripts/production_e2e.py
```

Optional bounded timing controls:

```text
python scripts/production_e2e.py --timeout-seconds 10 --poll-seconds 2 --max-wait-seconds 180
```

## Required success output

The run must report PASS for:

- authenticated test user
- organization/project isolation
- R2 upload plus deterministic validation
- pairwise scientific execution plus provenance

and finish with:

```text
Production scientific E2E passed.
```

Any timeout, rejected/error upload, failed/cancelled scientific job, missing result hash, missing tool/executor version, or missing provenance is a release failure.

## Data handling

The harness creates a uniquely named organization and project so concurrent or repeated runs cannot collide. These records are identifiable by the `Genithm E2E` / `Production E2E` naming convention.

V1 deliberately does not perform privileged automatic cleanup. Cleanup should be done through an authorized administrative process after validation so the test never receives elevated deletion credentials merely for convenience.

## CI boundary

`.github/workflows/production-e2e-contract.yml` tests the harness itself without production credentials. It does not execute the live production journey.

This separation is intentional:

- pull-request CI remains secretless;
- source control never receives test-user credentials;
- live E2E is executed only from an authorized deployment environment;
- the tested user path remains subject to normal authentication, RLS, Storage Gateway authorization, queues, and worker execution.
