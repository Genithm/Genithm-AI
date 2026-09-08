# Genithm AI Evidence Interpretation V1

## Purpose

Genithm AI Evidence Interpretation V1 explains completed authoritative scientific results without turning model output into scientific evidence.

The interpretation layer is separate from both planning and execution:

```text
User request
  -> AI planner proposes one action
  -> user approves
  -> authoritative Genithm worker executes
  -> terminal result + provenance are recorded
  -> user requests interpretation
  -> Genithm freezes a bounded evidence snapshot + SHA-256
  -> isolated AI worker explains only that snapshot
  -> database validates evidence references
  -> interpretation is stored with its own SHA-256 and provenance
```

The model does not rerun tools, fetch sources, inspect raw artifacts, or independently verify a result.

## Eligible authoritative states

V1 only creates interpretation evidence from terminal records that already satisfy the relevant workflow's authoritative completion contract:

- `scientific_job`: `completed`
- `blast_job`: `completed`
- `protein_annotation_job`: `completed` or `no_mapping`
- `sequence_retrieval`: `retrieved` or `not_found`

Queued, running, rejected, and error states are not interpreted as scientific results.

`no_mapping` and `not_found` retain their narrow recorded meaning. They are not converted into universal negative claims.

## Frozen evidence snapshot

At interpretation request time, Genithm constructs an `ai-evidence-v1` JSON snapshot from the authorized project resource. The snapshot is stored before provider invocation and hashed with SHA-256.

The evidence snapshot is capped at 64 KiB. It contains small structured facts such as:

- execution status;
- tool or source identity and versions;
- bounded result summaries;
- relevant accessions and source metadata;
- result/source hashes;
- source-check timestamps;
- for BLAST, at most the first 10 already-normalized hits.

The snapshot intentionally excludes raw FASTA, BLAST XML, complete alignment artifacts, Newick artifacts, storage object paths, unrestricted domain-entry bodies, credentials, and other large/raw data.

The worker re-checks the stored evidence SHA-256 when claiming a request. An integrity mismatch fails closed and no provider interpretation is accepted.

## Interpretation contract

Provider output uses `ai-interpretation-v1` and contains only:

- `schema_version`
- `summary`
- `findings`
- `limitations`

Each finding contains:

- a bounded `statement`;
- one or more `evidence_ids` that must exactly reference facts in the frozen snapshot.

The AI worker validates this shape locally. The database independently validates the schema, field bounds, and every evidence reference before storing the result.

Unknown evidence references are rejected.

## Grounding policy

The interpreter is instructed to use only the supplied evidence snapshot. It must not add scientific claims from model memory, web knowledge, literature, unstated biological assumptions, or external citations.

It must not invent:

- measurements or statistics;
- accessions or hits;
- domains, homology, or function;
- taxonomy;
- confidence or statistical significance;
- causal conclusions;
- clinical or diagnostic meaning;
- provenance.

Missing or null evidence means unavailable, not negative evidence.

## Authorization and isolation

An interpretation request requires the same authenticated user who owns the AI plan, current project write authorization, and an eligible terminal dispatched resource.

The provider never receives database credentials or unrestricted project access. It receives only the frozen evidence snapshot selected by Genithm.

The interpretation queue is service-role worker infrastructure. User-facing access is through narrow RPCs and RLS-protected request records.

## Rate and concurrency limits

V1 applies the AI interpretation scientific rate-limit policy and bounds simultaneous queued/interpreting requests per user and organization.

A plan has at most one interpretation request. Repeated requests reuse the existing request ID rather than creating multiple interpretations for the same dispatched plan.

## Provenance and audit

Each interpretation request records:

- evidence schema version and SHA-256;
- provider and model;
- prompt version;
- policy version;
- interpretation schema version and SHA-256;
- processing attempts and lifecycle timestamps.

Creation and status changes are written to the existing tamper-evident audit ledger. Audit metadata contains hashes and lifecycle metadata rather than raw evidence bodies.

## Failure behavior

Provider/network failures use bounded retries. Exhausted or non-retryable failures become `error` and do not alter the authoritative scientific result.

If the resource is not terminal, not authorized, not visible, or the evidence snapshot cannot be constructed within the bounds, the interpretation request is rejected rather than inferred.

## Scientific meaning

An AI interpretation is a convenience explanation of recorded evidence. It is not a new experiment, a new source lookup, a rerun of the underlying tool, independent validation, peer review, or a replacement for inspecting the authoritative result and provenance.
