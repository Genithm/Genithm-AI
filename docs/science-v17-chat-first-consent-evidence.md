# Science V17 — chat-first, consent-gated research execution and bounded evidence

## Why

The primary Genithm interaction is a conversation: the researcher provides scientific intent and data in chat, the platform asks only for missing prerequisites, and verified results return to the conversation. Existing scientific workers and database RPCs remain the only compute authority. No arbitrary LLM-selected executable commands or jobs are introduced.

## Executed path

1. The authenticated `request_ai_chat_turn` RPC enforces project ownership/write permissions and returns only project-scoped research context with the message ID.
2. `buildAuthorizedResearchContext` **preserves the SQL-generated authoritative per-resource eligibility flags** when available, and only for older schema snapshots derives fallback **candidate** lists for nucleotide/protein BLAST, protein properties, NCBI-origin protein annotation, aligned-input groups and completed MSA. It excludes malformed IDs, unvalidated sequence hashes and unfinished MSA results. Pending attachments remain visible as pending, not as eligible input.
3. The AI provider receives untrusted conversation history and deterministic preflight hints. It either asks for a missing item in chat (e.g., species, second sequence, ready validation) or proposes **one** existing validated fixed action using `propose_scientific_action`.
4. The application normalizes any proposed NCBI gene/organism to a canonical candidate RefSeq accession. Database `create_ai_plan_from_chat` revalidates the plan, persists a hash and provenance, and creates a `ready` proposal.
5. **The AI cannot dispatch that proposal in the chat API.** It returns `awaiting_approval`. The researcher approves in the *same conversation*, via `approve_ai_plan`, which revalidates project scope, inputs and compute policy in a row-locked transaction. Historical `create_ai_plan_from_chat` functions may write `requires_confirmation=false` for proposals; the chat UI uses the authoritative `ready` state to show the approval action, rather than mistakenly suppressing it.
6. Once existing workers finish, the conversation refreshes bounded RLS-scoped job status and displays **allowlisted recorded values**, not model-invented claims. Covered categories: scientific jobs, NCBI retrievals, BLAST, and protein annotations. Full verified scientific JSON uses the existing authenticated download path and recomputes the artifact SHA-256.

## Security boundaries

- Every ID supplied to the model originates in the authenticated scoped RPC context, and the authoritative request RPCs validate it again.
- Candidate preflight is advisory and is **not** an RLS or quota bypass. It makes no live database query using a service-role client.
- No unrestricted DAG, arbitrary shell, raw SQL, generic tool execution or external callback was added.
- No unapproved cost-bearing science is dispatched as a side effect of text generation. The same user must explicitly approve an existing plan.
- Results are projected via an **explicit field allowlist** and only from completed/eligible states; secrets, raw sequences and provider metadata are not displayed by default.
- Failed validation, cancelled jobs and incomplete retrievals do not produce fabricated scientific results.
- This change is code-only: no new migration and **no live Supabase or worker deployment**.

## Verification

- `apps/web/tests/chat-research-consent-v17.test.mjs` tests project preflight, duplicate/malformed resource rejection, pending-attachment isolation, completed MSA selection, four evidence families, explicit approval barrier, and data-only verified download linkage.
- Prior chat-first regression tests retained, updated for the precise approve button and allowlisted evidence builder.
- GitHub web CI: Node regressions, TypeScript, Next.js; existing Cloudflare and security checks must also pass before merging.

## Limitations

This is a bounded chat-to-science orchestration increment, **not** a promise of an unrestricted autonomous bioinformatics agent. The supported backend still handles only approved operations. An actual authenticated full-stack test requires the reviewed migrations to be present in a separate development Supabase database and the relevant workers running. Codespaces' unauthenticated local lab is independent of this feature. In-chat scientific metrics are compact summaries; immutable full artifacts remain available through an authenticated integrity-checked download path.
