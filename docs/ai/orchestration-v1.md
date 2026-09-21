# Genithm AI Orchestration V1

## Purpose

Genithm AI converts natural-language scientific requests into permission-controlled plans. The language model is a planner, not an authority and not an executor.

V1 normally supports one scientific action per plan. V1.1 additionally supports one bounded two-step workflow action, `msa_phylogeny_workflow`, for MSA followed by phylogeny. General multi-step autonomous DAG execution remains deferred until broader workflow-level validation, checkpointing, recovery, and policy semantics are implemented.

## Trust and authority model

```text
Authenticated user
  -> request_ai_plan RPC
  -> tenant/project authorization + AI planning rate/concurrency limits
  -> ai_planning PGMQ queue
  -> isolated AI planner worker
  -> structured ai-plan-v1 JSON
  -> database policy/resource validation
  -> READY plan
  -> explicit user Approve & run
  -> database re-validates authorization + current resource state + plan
  -> existing authoritative request RPC
  -> existing source/scientific worker queue
  -> deterministic/evidence-backed result + provenance
```

The model cannot:

- call scientific tools directly;
- call arbitrary database functions;
- write application tables;
- access the production database directly;
- execute shell commands;
- expand its own permissions;
- turn confidence into authorization;
- invent a project resource ID and make it executable;
- bypass explicit user approval in V1.

## Supported actions

The V1 policy allowlist contains:

- `ncbi_sequence_retrieval`
- `blast`
- `pairwise_alignment`
- `multiple_sequence_alignment`
- `phylogenetic_tree`
- `protein_properties`
- `protein_annotation`
- `msa_phylogeny_workflow` (bounded MSA → phylogeny chain)

A plan may contain only one executable action. `msa_phylogeny_workflow` counts as one allowlisted action whose internal shape is fixed to exactly two ordered steps: MSA, then phylogeny. When the requested capability is supported but required material is missing or ambiguous, the planner returns `intent=clarification_required` with `action=null` and asks a precise follow-up in the conversation. `intent=unsupported` is reserved for capabilities the current planner cannot perform.

## Provider context minimization

The AI worker receives only context constructed by Genithm after tenant/project authorization. It does not query arbitrary tables or storage objects.

Current bounds are:

- up to 8 previous conversation messages, each truncated to 4,000 characters;
- up to 100 recent ready single-record sequence metadata entries;
- up to 30 recent scientific job summaries;
- up to 30 recent NCBI retrieval summaries;
- up to 20 recent protein annotation summaries.

Raw FASTA objects, raw BLAST XML, MSA FASTA artifacts, Newick artifacts, and pairwise alignment artifact bodies are not included in planner context.

Project context and prior conversation text are explicitly treated as untrusted data in the planner instructions. They cannot override the system policy.

## Structured plan contract

Planner output uses `ai-plan-v1` with these top-level fields only:

- `schema_version`
- `intent`
- `summary`
- `limitations`
- `action`

The worker requests strict JSON-schema output from the configured provider and then performs a local shape check. The database independently validates the plan again against the current project and allowlist.

A stored plan is hashed with SHA-256. Audit events record lifecycle metadata and the plan hash, not the raw user prompt.

## Approval and dispatch

A `ready` plan is not an execution grant. The requesting user must explicitly approve it.

At approval time Genithm:

1. confirms the same authenticated requester owns the plan;
2. confirms current organization/project write authorization;
3. re-validates the stored plan;
4. verifies referenced resource IDs still belong to the project and remain eligible;
5. calls the existing hardened internal request function for that scientific workflow;
6. records the dispatched resource type and ID.

This means model output never becomes direct SQL/tool invocation.

## Provider adapter

The first worker adapter targets the OpenAI Responses API. Provider and model selection are configuration, not authorization logic.

The worker sends:

- a fixed Genithm planner policy prompt;
- the current user request;
- bounded authorized project context;
- a strict JSON schema;
- `store: false`.

The AI worker uses no provider SDK runtime dependency; HTTPS requests use the Python standard library. This keeps the worker dependency surface small.

## Secrets and deployment

The AI worker requires these server-side environment variables supplied by the deployment secret manager:

- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`
- `OPENAI_API_KEY`
- `GENITHM_AI_MODEL`

None belongs in browser code, `NEXT_PUBLIC_*`, repository files, images, logs, or user-visible responses.

The repository contains the worker and its hardened container, but continuous worker hosting and production secret-manager wiring are separate deployment work. Do not claim AI plans are processed live until that runtime is deployed.

## Failure behavior

Provider/network failures do not execute scientific work. Planning requests use bounded retries and become `error` when exhausted. Core scientific workflows remain independently available without the AI planner.

## Bounded MSA → phylogeny workflow

When a user explicitly requests alignment of 3-50 compatible ready sequences followed by a phylogenetic tree, Genithm may propose `msa_phylogeny_workflow`.

The workflow keeps the existing authority boundaries:

1. the planner proposes exact authorized sequence IDs;
2. the database validates the complete plan and inputs;
3. the user gives one explicit approval;
4. the existing authoritative MSA RPC creates the first scientific job;
5. a workflow checkpoint records the MSA job;
6. only an authoritative successful MSA status transition can dispatch the FastTree job;
7. the downstream phylogeny request re-validates user membership, source provenance, tool approval, rate limits, and concurrency;
8. failure or cancellation of either step stops the workflow and records an auditable terminal state.

The model cannot insert steps, branch dynamically, bypass a failed prerequisite, choose a shell command, or directly dispatch the second job.

## Current limitations

- no general autonomous multi-step DAG execution beyond the fixed MSA → phylogeny workflow;
- no general literature RAG in this milestone;
- no model-generated scientific result accepted as tool evidence;
- no direct raw artifact access by the planner;
- no automatic approval;
- no claim of production provider execution until worker deployment is connected.


## Intelligent prerequisite clarification

The planner must inspect authorized project context before asking the user for information it already has.

Examples:

- If a tree is requested and exactly one completed MSA is eligible, Genithm may propose that MSA.
- If several completed MSAs are eligible, Genithm asks which one to use and names safe human-readable choices where available.
- If no completed MSA exists, Genithm explains that phylogeny needs an MSA and asks the user to provide/select compatible sequences so the prerequisite can be created.
- BLAST requires one ready single-record sequence; pairwise alignment requires two; MSA requires 3-50 compatible sequences; protein workflows require eligible protein inputs.
- Genithm never invents a sequence ID, accession, prior job, or scientific result to avoid asking a clarification.

A clarification response is stored as a normal assistant message in the same AI conversation. It is never approvable or dispatchable. The user's next message is planned with bounded recent conversation history plus refreshed authorized project context, allowing the workflow to continue naturally after the missing information is supplied.
