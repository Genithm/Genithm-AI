# Science V14 — approved autonomous protein research pipelines

## Product milestone

V14 introduces a narrowly bounded autonomous execution template:

**One explicit user approval → NCBI protein accession retrieval → private FASTA ingestion and independent sequence validation → approved protein-properties scientific job → provenance-linked result and report.**

This is an end-to-end, event-driven chain that only advances after the authoritative source and input prerequisites complete. The researcher authorizes a specific downstream computation in advance; the template cannot dispatch arbitrary tools, unrestricted AI commands or open-ended scientific queries.

### Production components

- Additive source-controlled SQL migration: 20261012204500_autonomous_research_protein_pipeline_v1.sql
  - Immutable run scope and fixed template.
  - Owner-scoped, force-enabled RLS with read-only browser access.
  - Unique retrieval and scientific job linkage for replay resistance.
  - Lock-serialized advancement triggered by retrieval, FASTA and scientific job state changes.
  - Existing NCBI and protein-properties request functions reused with their scientific limits, approved tools, fingerprints, queue and rate/concurrency protections.
  - Explicit terminal failure codes; no hidden retries or recomputation loops.
- New authenticated /dashboard/pipelines UI: project and accession selection, scope of consent, recent pipeline history and safeguards.
- New /dashboard/pipelines/[id] UI: three-stage evidence, status, timestamps, input hash, linked scientific result and sealed report.
- Owner-scoped diagnostic manifest at /dashboard/pipelines/[id]/manifest (private/no-store, metadata only).
- Type additions and navigation from dashboard and guided research journey.
- Node regression suite integrated into CI for lifecycle, authorization, source identity, input integrity and SQL safety contracts.

## Security and consistency

Every pipeline is created by a signed-in user through the narrow request_research_protein_pipeline(project_id,accession) RPC. The database verifies organization write access and explicitly rejects deduplicated project-wide NCBI retrievals belonging to a different user. A single retrieval ID can back at most one run.

The internal advancement function is never granted to browser or service-role callers; it is only invoked by narrowly scoped triggers and the authenticated pipeline creation function. Each event takes a FOR UPDATE lock on the pipeline row; a subsequent event with an already-dispatched stage returns without queueing a second scientific job. The scientific job is issued via the existing validated protein-properties function, not direct insertion or PGMQ manipulation.

The existing scientific request function gets its actor from auth.uid(). The trigger temporarily sets the already-verified workflow owner's request claim for that single validated dispatch, then restores the original claim in both success and failure paths. It does not take that actor from a request parameter controlled by the browser. Source, actor, organization, project, upload ownership and SHA-256 are checked before dispatch. Job ownership, input and source hashes are cross-checked afterward.

A failed source, invalid FASTA, failed dispatch, cancelled computation or bad digest terminates the pipeline. The application has no replay, retry, general-purpose editing or worker-bypass API. A new pipeline requires a new explicit user action.

The read-only reconciliation checks recorded identity before displaying a complete chain. A matching metadata digest is not a fresh rehash of storage bytes. The established authenticated scientific download path handles artifact integrity.

## Rollout limitations

**The SQL migration is not applied to live Supabase as part of this code milestone.** Until controlled rollout, the UI reports that autonomous execution is unavailable and no pipeline jobs can be started. Staging acceptance must verify source worker, FASTA validation, trigger advancement, completed job outputs, concurrency and owner-only RLS under real worker queues.

The migration is additive and leaves existing MSA→FastTree workflows, service keys and AI planner logic untouched.

## Required checks

    cd apps/web
    npm ci
    node --experimental-strip-types --test tests/research-pipeline.test.mjs
    npm run typecheck
    npm run build

CI Cloudflare contract, security policies, dependencies and worker tests remain mandatory before merging.

**Scope:** A genuine autonomous but narrowly preapproved three-stage protein-profile workflow. Arbitrary AI agents and live deployment remain separate.
