# Chat-first research milestone V17 — one conversation for scientific work

## User outcome

The default Genithm experience is one conversation: users describe their
research goal, attach their input to the conversation and receive scientific
progress, measured outputs and evidence links without opening unrelated forms.

### Codespaces (immediately visible, no Supabase keys)

Visit /preview. The first scientific workspace is now a chat-shaped interface
to the **existing bounded local Python scientific engine** through the private
development-only /api/dev-science bridge. It can:
- Ask for missing DNA/RNA input, an explicit motif, or the correct number of
  named FASTA sequences rather than directing a user to different forms.
- Accept a small .fa/.fasta/.fna/.txt attachment (up to 5,500 bytes) or pasted
  nucleotide data. Keep the data only in that browser session.
- Execute explicit, fixed intents: ORF discovery, six-frame translation,
  IUPAC motif scanning, reverse complement, GC/composition quality, pairwise
  global/local alignment, identity matrix, MSA and tree inference.
- Show numeric summaries, bounded detail previews, tool versions and the
  input SHA-256 directly inside the conversation. Export full JSON locally.
- Preserve old manual labs in a collapsed **Advanced research labs** section.

**Critical limitation:** This local chat is deterministic rule-based routing,
NOT a connected AI agent. It cannot handle arbitrary language, NCBI queries,
protein analysis, customer datasets, billing, persistence or signed outputs.
It uses the same scientific API boundary already verified in Codespaces
preview tests; results are exploratory and never represented as authoritative
production records. MAFFT/FastTree binaries are required for the corresponding
local operations.

### Authenticated web chat (requires separate development infrastructure)

In /dashboard/ai:
- The first chat can create an authorized private project through one explicit
  Start my research chat action, using an accessible existing organization or
  the existing create_organization RPC. No compute starts without user intent.
- Existing AI streaming, chat-attached FASTA/image uploads, server-side
  scientific action validation, approval and provider routes are reused.
- In a conversation, scientific status, user approvals, bounded recorded result
  metrics, immutable result hash, verified full-result download link, and
  evidence-grounded interpretation render **above the reply composer**.
- The page refreshes status every 9 seconds only while requests/jobs are active
  and the document is visible.
- Approve & run returns to the conversation, never navigates away to the
  scientific job page; advanced evidence and full downloads remain available
  as optional deep links.
- All project/conversation/job data is fetched with the user's Supabase JWT
  and existing RLS; no service-role secrets, schema changes, new arbitrary
  executor, or unapproved scientific tools.

The signed-in production chat and local Codespaces demo have **different trust
levels**. A local result is not a database job result, and a database summary
is labeled recorded metadata rather than a newly verified raw artifact.
Full scientific downloads use existing integrity verification endpoints.

## Verification and rollout

- scripts/test_codespaces_chat_first.py tests input limits, fixed intent
  allowlist, private onboarding, approvals and in-chat progress/evidence.
- Codespaces Preview Contract runs the test and does the existing actual
  HTTP /preview + real local Python science API checks.
- CI runs the contract with Next.js typecheck/build and existing workers.
- New SQL migrations: **none**.
- Real authenticated chat needs a properly migrated development Supabase
  project, API upload service, scientific workers and an AI provider. A
  Codespaces offline preview by itself does not enable those capabilities.

## Follow-on work

Next milestones can expand signed evidence rendering (full alignment windows,
BLAST hit tables and structured phylogeny) inside chat, persist UI artifacts and
add conversation-native multi-job orchestration. No arbitrary AI-generated
command execution or cross-project data access is permitted.
