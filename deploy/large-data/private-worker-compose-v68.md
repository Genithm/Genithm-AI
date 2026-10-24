# Genithm V68 — private file-worker container launch contract

This is an **operator-controlled deployment template**, not automatic cloud deployment. It does not activate Genithm on a hosted server, create a bucket, provision compute or grant quotas. It packages the *existing* reviewed Python API image into a dedicated large-file verifier process and an **optional** paired FASTQ verifier; the normal API image entrypoint is overridden so these containers run the worker modules instead of the HTTP web server.

## Requirements

- A secured Docker Compose v2 host, with CPU and memory capacity, outbound HTTPS to Supabase and the private S3-compatible API, and a compatible reviewed API image build.
- Fully migrated Genithm Supabase database. The operator must provision a **private** S3-compatible quarantine bucket, path-scoped server credentials, correct TLS endpoints, CORS limited to the deployed web origin, lifecycle cleanup and a monitored budget.
- Project upload limits must be enabled **explicitly** by an authorized administrator. The code does not automatically enable quotas or increase commercial spending.
- A separate restricted file outside the Git checkout, e.g. `/etc/genithm/large-data-worker.env`, permissions 0600, containing **server-only** variables: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `GENITHM_LARGE_DATA_ENDPOINT`, `GENITHM_LARGE_DATA_PUBLIC_ENDPOINT`, `GENITHM_LARGE_DATA_BUCKET`, `GENITHM_LARGE_DATA_ACCESS_KEY_ID`, `GENITHM_LARGE_DATA_SECRET_ACCESS_KEY`, `GENITHM_LARGE_DATA_REGION`, and `GENITHM_LARGE_DATA_MAX_EXPANDED_BYTES`. Never use a `NEXT_PUBLIC_` variable for secrets, put credentials in this repository or share an unredacted Compose config/log.

## Launch (operator action only)

Run commands on the secured machine with repository access:

```sh
export GENITHM_LARGE_DATA_WORKER_ENV=/etc/genithm/large-data-worker.env
docker compose -f deploy/large-data/compose.worker.yml config --quiet
docker compose -f deploy/large-data/compose.worker.yml up -d --build verifier
```

The separately gated paired-end validator can be enabled only if its SQL migration and quotas are ready:

```sh
docker compose -f deploy/large-data/compose.worker.yml --profile paired up -d --build
```

The verifier reports its capability heartbeat about every 30 seconds. Verify **fresh database-backed `large_data_worker_heartbeats` records and correct storage identity**, then confirm the UI reports the verifier online. Liveness of a Docker process **alone is not scientific readiness**. Test an authorized project with a real small FASTQ/VCF/GFF3 upload and confirm whole-object SHA-256 and scientific counts before admitting large files. Verify private access denies foreign tenant reads and expired sessions.

Stop without deleting the database or private bucket:

```sh
docker compose -f deploy/large-data/compose.worker.yml --profile paired stop
```

The worker uses read-only container filesystems, a small ephemeral tmpfs, no host mounts or inbound ports, a non-root API image user, dropped Linux capabilities, no privilege escalation and constrained PID/memory/CPU. Fenced worker leases prevent a stopped/stale worker from publishing completed scientific results. It does not expose S3 credentials to browsers.

For signed URL expiry, quota accounting, object cleanup, orphan multipart lifecycle, worker failures and staged 10/50/100-GiB capacity testing, follow `deploy/large-data/README.md`. This container template is not a claim that those production tests have passed or that the service is currently active.
