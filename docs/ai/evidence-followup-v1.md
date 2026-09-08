# Evidence-grounded AI follow-ups V1

Genithm evidence follow-ups let a user ask a question about one completed AI interpretation without widening the model's scientific authority.

## Trust chain

The V1 trust chain is intentionally one-way:

1. A user requests a scientific action.
2. The AI planner proposes a bounded action.
3. The user approves the action and Genithm revalidates it before dispatch.
4. An authoritative scientific worker or source connector produces the recorded result.
5. Genithm freezes a bounded `ai-evidence-v1` snapshot and its SHA-256 for interpretation.
6. The interpreter may explain that snapshot but cannot modify it or become a scientific evidence source.
7. A follow-up request reuses the exact same frozen evidence snapshot and SHA-256. It does not rebuild evidence from the current database state.
8. The follow-up responder answers only from that frozen snapshot or returns `insufficient_evidence`.

Planning, execution, interpretation, and follow-up answering remain separate lifecycles and trust layers.

## Follow-up contract

A question is bounded to 4,000 characters and is treated as untrusted data. Instruction-like text in the question or evidence cannot change the responder policy.

The worker requires strict `ai-evidence-answer-v1` structured output:

- `status`: `answered` or `insufficient_evidence`
- `direct_answer`: one statement plus evidence IDs
- `supporting_points`: optional grounded statements plus evidence IDs
- `limitations`: bounded statements describing evidence limits

For `answered`, the direct answer and every supporting point must cite evidence IDs present in the frozen snapshot.

For `insufficient_evidence`:

- the direct answer has no evidence IDs;
- supporting points must be empty;
- at least one limitation is required;
- the model must describe the missing evidence without inventing it.

The PostgreSQL completion RPC independently validates these rules after worker-side validation.

## Immutable inputs and reproducibility

At request time Genithm copies the completed interpretation request's existing evidence snapshot and evidence SHA-256. It does not perform a fresh source lookup and does not rebuild the snapshot from live execution tables.

The normalized question is SHA-256 hashed. When a worker claims the request, Genithm recomputes both the question hash and evidence hash before provider processing. A mismatch fails closed.

The completed structured answer is also SHA-256 hashed and stored with provider, model, prompt-version, and policy-version provenance.

Identical active or completed questions over the same interpretation and evidence snapshot are idempotently reused rather than silently creating another model answer.

## Scientific-integrity boundary

The responder may not use:

- model memory as scientific evidence;
- web or literature searches;
- outside citations;
- previous assistant messages as evidence;
- unstated biological assumptions;
- raw artifacts that were not included in the frozen evidence packet.

It may not run or claim to run BLAST, alignments, phylogenetic tools, annotation lookups, calculations, experiments, source checks, or independent validation.

Null or missing evidence means unavailable, not negative evidence. Source-state qualifiers such as `no_mapping` retain their original narrow meaning.

## Authorization and limits

Only the owner of a completed interpretation with current project write authorization may request a follow-up. The follow-up table uses forced RLS and authenticated callers receive read-only access to their authorized rows.

Worker claim and finish RPCs are service-only. Private definer functions use an empty search path and explicit schema qualification. Request rates and active concurrency are bounded.

The follow-up evidence snapshot remains capped at 64 KiB and the structured answer at 32 KiB.

## Auditability

Request creation and status transitions are appended to Genithm's existing tamper-evident audit ledger with hashes and model/policy provenance. The question text itself is not duplicated into audit metadata; its SHA-256 is recorded instead.

## Scientific meaning

A follow-up answer is a convenience explanation of the same recorded evidence. It is not a new experiment, a fresh database query, a source refresh, a rerun of the underlying tool, independent verification, peer review, or a replacement for inspecting the authoritative result and provenance.
