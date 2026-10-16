# Genithm BioAI V32 — A conversation-first bioinformatics product

## Product contract

Genithm is not a dashboard that occasionally calls an LLM and is not a local demo of DNA tools. **Its core product is a conversational biological research assistant**: researchers can ask in natural language, attach FASTA/sequence data and scientific images, specify accessions, discuss analysis plans, explicitly authorize computing, then read recorded scientific outputs and reproducible evidence inside the same conversation.

The AI assistant's UX should feel familiar to users of general chat assistants while being specialized for actual bioinformatics computation and provenance. The existing separate advanced tools remain accessible to scientists who need precise settings and large workflows; they do not dominate the chat-first home.

## V32 working experience

- **Chat is home**: `/dashboard` already redirects to `/dashboard/ai`. The AI landing view now centers on the message composer, with searchable RLS-scoped recent conversations.
- **Science starters**: six real interactive prompt starters for NCBI nucleotide ORFs, NCBI protein profiling, alignments, BLAST, phylogenetics and broad research planning. Clicking prefills the actual chat message (never fabricates a job). Fixed, fully specified NCBI starters are disabled while workers are unready; other prompts can still be used for planning.
- **Easy first-use**: authenticated users with no research project can create a lab through the existing `create_organization` RPC and project through the existing RLS-protected `projects` table, directly from the AI start screen. No privileged service role and no second Supabase project.
- **Conversation as the scientific surface**: a shared sidebar lists recent chats, the thread shows chat messages with clear AI/researcher authorship, and the composer stays accessible. Research activity and results can be expanded inside the chat. The original confirmation, status, source and integrity checks remain authoritative.
- **Accessible advanced workflow navigation**: minimize the primary top nav to BioAI chat, scientific tools, research history and reports, with secondary research and business tools in a discoverable menu.
- **No pretend computation**: a green build is not an executed bioinformatics job. Scientist-visible fixed NCBI actions remain unavailable unless server-only science flag, migrations and all six worker/queue heartbeats pass. A computation never runs on merely choosing a starter; the new user message and explicit approval are still required.

## End-to-end researcher journey

1. Sign in at `/login`, land in `/dashboard/ai`.
2. Create a lab and research project directly from the chat page if needed.
3. Ask a biological question or click an analysis starter; the real composer fills with the appropriate request.
4. Optionally attach a FASTA through the existing secure Storage Gateway (file validation, status and access-scoped upload).
5. Send the message. General AI reasoning streams in the conversation; suitable requests can produce a plan.
6. For any scientific execution, inspect the plan and explicitly approve the appropriate action. Never equate an AI answer with completed scientific computation.
7. Watch progress and open the evidence panel in the conversation. Inspect the recorded result summary, result hash and authenticated artifact downloads.
8. Return to prior conversations from the sidebar or open the full research history/advanced-tools view when needed.

## Security and deployment

V32 does **not** create a new Supabase project, bypass RLS, alter the science-schema migrations, add secret-bearing frontend variables or auto-approve queued research. It is a real web UX/onboarding integration over the existing Supabase/Auth/AI/worker services.

The Codespaces `/preview` fixture remains only a sample lab, not the Genithm product. For integrated authenticated testing use `bash scripts/codespaces_preview.sh` and open `/login`; API/worker Docker images must be published and all queues/heartbeats must be healthy. The production Cloudflare/Oracle deployment remains separate.

V32 CI includes `apps/web/tests/bioai-conversation-product-v32.test.mjs`, authenticated-entry and science V20–V31 regressions, TypeScript and Cloudflare web contract.
