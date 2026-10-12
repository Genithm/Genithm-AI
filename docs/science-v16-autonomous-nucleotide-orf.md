# Science V16 - approved autonomous nucleotide ORF research workflow

## Delivered functionality

A second explicitly authorized fixed scientific pipeline extends V14:

1. The researcher approves one NCBI nucleotide accession retrieval.
2. Existing retrieval and FASTA validation workers produce exactly one DNA/RNA FASTA input, up to 50,000 bases, 2 MiB and with a recorded SHA-256.
3. Database advancement automatically dispatches exactly one approved sequence_insights / orf_scan job with fixed motif=null and min_aa=30.
4. The established scientific worker produces authenticated results and provenance.
5. Completion is recorded only when exact ownership, project, scientific job type, ORF operation, parameter values and input hash are consistent.

It cannot run arbitrary AI commands, arbitrary motifs, other sequence operations, or other scientific jobs.

## Secure architecture

- Additive source-controlled SQL migration 20261012211000_autonomous_nucleotide_orf_pipeline_v1.sql is applied after V14.
- Extends the constrained research_pipeline_runs template without changing the existing owner-only forced RLS model.
- Reuses existing row-locked event advancement, NCBI retrieval idempotency, source/validation completion triggers and scientific job completion trigger.
- Reuses the approved scientific sequence_insights request function, its job fingerprints, scientific rate limits and worker quotas; never inserts arbitrary queue messages.
- The new narrowly scoped public.request_research_nucleotide_pipeline checks signed-in actor, active project, organization write access and ownership of any deduplicated NCBI retrieval.
- Validates DNA/RNA type and single-record sequence; no gaps and recorded input SHA-256. Scientific job dispatch is bound to an exact fixed ORF operation.
- Matches worker result with scientific_job_inputs and completion hashes. Terminal source or scientific failure does not automatically replay work.

## Frontend integration

The /dashboard/pipelines screen now includes separate protein-properties and nucleotide ORF approval forms, with clear scopes of consent. The per-run detail page, auto-refresh and private diagnostic manifest support both templates.

The V15 comparative study builder remains intentionally protein-only; ORF metrics are not silently mixed with protein-properties measurements.

## Verification and release

- Node regression tests in apps/web/tests/research-pipeline-v16.test.mjs verify identity, nucleotide alphabet, ORF parameters, failure handling and V14 backward compatibility.
- Disposable local Supabase SQL contract in supabase/tests/v16_nucleotide_pipeline_contract.sql checks forced RLS, safe grants, exactly two templates, event-trigger topology and internal state-machine safety.
- GitHub CI runs those alongside TypeScript, production web build, Cloudflare, dependency and worker checks.

Production deployment, real-source worker integration tests and migration activation are separate. This milestone intentionally does not apply migrations to the live database.
