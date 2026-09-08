# Continuous worker deployment V1

Genithm's asynchronous scientific and AI queues require continuously running workers. The current production worker surface is six long-lived processes:

| Deployment | Responsibilities |
| --- | --- |
| `sequence-worker` | FASTA validation and sequence statistics |
| `source-worker` | live NCBI sequence retrieval and protein annotation source adapters |
| `blast-worker` | NCBI remote BLAST submission, polling, and result capture |
| `scientific-worker` | approved deterministic scientific jobs such as pairwise alignment, MSA, phylogeny, and protein properties |
| `audit-worker` | audit checkpoint signing |
| `ai-worker` | AI planning, evidence-grounded interpretation, and frozen-evidence follow-up |

The Kubernetes template is `deploy/kubernetes/workers.yaml`. It intentionally contains image placeholders and is **not** directly deployable. Every release must render it with immutable digest-pinned images using `scripts/render_worker_deployment.py`.

## Runtime security contract

Every worker deployment:

- runs exactly one replica in V1 to avoid unnecessary duplicate queue consumers while load is low;
- uses `Recreate` rollout semantics so the old process exits before the replacement starts;
- disables Kubernetes service-account token mounting;
- runs as non-root;
- forbids privilege escalation;
- uses a read-only root filesystem;
- drops all Linux capabilities;
- uses the runtime-default seccomp profile;
- has explicit CPU and memory requests/limits;
- accepts no inbound network traffic;
- is allowed DNS plus outbound TCP/443 only.

Workers do not expose HTTP ports. Queue liveness is therefore monitored through Genithm's database/API operational health and readiness surfaces rather than container HTTP probes.

## Secrets

The template references a Kubernetes Secret named `genithm-worker-secrets` in namespace `genithm-workers`. The Secret object and values must be created by the deployment platform/secret manager and must not be committed to Git.

Required keys across the worker set:

- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`
- `NCBI_EMAIL`
- `OPENAI_API_KEY`
- `GENITHM_AI_MODEL`
- `GENITHM_AUDIT_SIGNING_KEY_ID`
- `GENITHM_AUDIT_SIGNING_PRIVATE_KEY_BASE64`

Optional:

- `NCBI_API_KEY`

`SUPABASE_SECRET_KEY` must be a backend-only Supabase secret/service credential. It must never be exposed to the browser. The audit signing private key must be separately controlled and rotated according to the audit-key runbook; it must not be reused for unrelated signing.

## Rendering a release

Each image must be supplied as a registry reference pinned by SHA-256 digest. Mutable tags such as `latest` are rejected.

Example shape:

```text
python scripts/render_worker_deployment.py \
  --image sequence=REGISTRY/genithm-sequence-worker@sha256:<digest> \
  --image source=REGISTRY/genithm-source-worker@sha256:<digest> \
  --image blast=REGISTRY/genithm-blast-worker@sha256:<digest> \
  --image scientific=REGISTRY/genithm-scientific-worker@sha256:<digest> \
  --image audit=REGISTRY/genithm-audit-worker@sha256:<digest> \
  --image ai=REGISTRY/genithm-ai-worker@sha256:<digest> \
  --output /tmp/genithm-workers.release.yaml
```

The rendered manifest should then be reviewed and applied by the deployment environment. The renderer fails closed if a worker image is missing, unknown, mutable, or not digest-pinned.

## Release verification

After deployment:

1. Verify all six Deployments have one available replica and no crash loop.
2. Verify the public API `/api/v1/health` and `/api/v1/ready` release smoke gate passes.
3. Verify queue backlog does not grow unexpectedly in operational health.
4. Run one controlled end-to-end scientific workflow only after all workers are confirmed continuously available.
5. If a worker crashes, do not purge queue messages. PGMQ visibility and existing bounded retry/finalization semantics preserve recovery behavior.

## Current boundary

This repository now defines a hardened, vendor-neutral continuous-worker deployment contract, but it does not itself provision a Kubernetes cluster, container registry, or secret manager. Until a real deployment environment is connected and the six images are published/deployed, Genithm must not claim that queued scientific work is automatically executing in production.
