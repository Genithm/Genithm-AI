# Genithm Science V2 — guarded production activation

**Audience:** infrastructure operator with authorized Kubernetes, GitHub Actions, and
Supabase deployment access. This document does not imply that a GitHub merge
deploys workers or runs SQL against production.

## Current activation boundary

Science V2 consists of two already-reviewed Supabase migrations and a new worker release:

- `20261012101500_sequence_intelligence_v1.sql`: four bounded sequence tools.
- `20261012123000_ai_sequence_intelligence_dispatch_v1.sql`: AI planner dispatch for these tools.
- Scientific worker **0.5.0+** and AI worker **0.5.0+** are required for end-to-end execution.

The migration files must remain unapplied **until the corresponding worker
images are deployed and fresh**. Old scientific workers can claim and fail
new job types. A successful GitHub workflow release only publishes artifacts;
it does not configure a production Kubernetes cluster.

## 1. Use the exact tested GitHub release

Open **Actions → Worker release** in `Genithm/Genithm-AI`. Choose a successful
run on `main` with a full source commit SHA that contains both Science V2 PRs.
Download its artifact:

`genithm-worker-release-<full-source-sha>`

The artifact contains `worker-release.json` and `genithm-workers.yaml`.
The successful **Worker production preflight** GitHub Actions workflow can
verify the same release run ID and source SHA before handoff.

Never retag the images or use `:latest`. Images must be immutable
`@sha256:<digest>` references.

Run from the repository root with the downloaded artifact under `release/`:

```sh
python scripts/validate_worker_release.py \
  --release-manifest release/worker-release.json \
  --deployment-manifest release/genithm-workers.yaml \
  --expected-revision "$RELEASE_SHA"
```

`RELEASE_SHA` must be the release artifact's full 40-character tested commit;
do not substitute a newer `main` SHA without generating a matching release.

## 2. Verify Kubernetes target and external secrets

Check the selected cluster explicitly:

```sh
kubectl config current-context
kubectl -n genithm-workers get secret genithm-worker-secrets
```

The secret is installed by your authorized infrastructure secret manager;
**do not add real keys to source, logs, chat, CI variables, or this document**.
The deployment references (without embedding values):

- `SUPABASE_URL`, `SUPABASE_SECRET_KEY`
- `GENITHM_AI_PRIMARY_API_KEY`, `GENITHM_AI_PRIMARY_ENDPOINT`,
  `GENITHM_AI_PRIMARY_MODEL`
- Optional backup: `GENITHM_AI_BACKUP_API_KEY`,
  `GENITHM_AI_BACKUP_ENDPOINT`, `GENITHM_AI_BACKUP_MODEL`
- Source worker: `NCBI_EMAIL`; audit worker:
  `GENITHM_AUDIT_SIGNING_KEY_ID`,
  `GENITHM_AUDIT_SIGNING_PRIVATE_KEY_BASE64`

The AI manifest defaults to `GENITHM_AI_PRIMARY_PROVIDER=qwen` and
`GENITHM_AI_BACKUP_ENABLED=false`. If backup is enabled in the Kubernetes
ConfigMap, all three backup credentials are required or startup fails closed.
Provider endpoints and models must match the configured provider.

## 3. Deploy the digest-pinned worker release

Only after the operator has confirmed the correct cluster, credentials, and
approved source revision:

```sh
kubectl apply -f release/genithm-workers.yaml
kubectl -n genithm-workers rollout status deployment/sequence-worker
kubectl -n genithm-workers rollout status deployment/source-worker
kubectl -n genithm-workers rollout status deployment/blast-worker
kubectl -n genithm-workers rollout status deployment/scientific-worker
kubectl -n genithm-workers rollout status deployment/audit-worker
kubectl -n genithm-workers rollout status deployment/ai-worker
python scripts/verify_worker_rollout.py \
  --release-manifest release/worker-release.json \
  --deployment-manifest release/genithm-workers.yaml \
  --expected-revision "$RELEASE_SHA"
```

The verifier uses **read-only** Kubernetes requests and checks that all six
Deployments are current, ready and running the *exact approved image digests*.

If any image is missing, a pod fails to start, or the cluster is inaccessible,
**stop** and investigate its startup events. Never weaken the check to
`kubectl get pods` alone.

## 4. Confirm real worker heartbeats, before any new migration

Configure an operator-only Postgres connection with a secure `PGSERVICE` /
`PGPASSFILE` / secret manager, rather than passing credentials as command-line
arguments. `psql` must be installed. A role with read-only access to worker
heartbeat state, migration history and relevant function definitions suffices.

```sh
python scripts/worker_activation_gate.py --stage workers
```

The gate reads only operational metadata, checks all **six** worker heartbeats
are at most five minutes old, and rejects scientific or AI workers older than
version 0.5.0. It makes **no changes** to your database.

If this step is blocked, **do not apply the migrations**. Diagnose the
external worker host, runtime configuration, network to Supabase, and
Kubernetes secret references before retrying.

## 5. Apply database changes *after* workers are healthy

Confirm the linked Supabase project and the exact two pending migration
versions using the Supabase CLI (`supabase --help` and
`supabase migration --help` on your installed version). Review
`supabase migration list --linked` before deploying. Confirm no
unexpected migrations would be included by `supabase db push`.

Then, from the appropriate authenticated deployment workstation, deploy the
reviewed pending migrations in ascending order with Supabase's linked
migration workflow. **Do not paste the SQL into the production SQL editor
without migration history**, and do not blindly push unrelated migrations.

Finally run:

```sh
python scripts/worker_activation_gate.py --stage schema
```

This additionally requires both migration versions, the authorized request
and finish RPCs, the AI dispatch function, the actor security binding, and
the new sequence action route.

## 6. Smoke test with non-sensitive fixture data

Within an authorized Genithm test project, upload a single-record DNA FASTA:

```fasta
>genithm-v2-smoke
ATGAAATAA
```

After upload validation, run **ORF scan** with minimum length 2 amino acids.
The deterministic result should include the plus-strand `MK` ORF at
1-based inclusive coordinates 1–9 and a verifiable downloadable JSON artifact.
Then use AI chat to ask for an ORF scan of that explicitly selected sequence.

Verify scientific-job completion, user/project isolation, tool provenance
and no persistent failures. This is an *authorized test action* and must not
be performed automatically against customers' projects.

## Recovery

If workers are stale or wrong-version, fix the deployment and re-run gates.
If the schema is already applied, **do not roll back to an older scientific
worker that cannot handle `sequence_insights` queued messages**. Restore a
compatible 0.5.0+ release or coordinate a controlled queue/schema rollback with
an audited incident process. GitHub CI passing does not imply successful
production activation.
