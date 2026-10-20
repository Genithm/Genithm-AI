# Genithm V48 — explicitly selected, verified file evidence in AI chat

V47 stores research files privately and validates their bytes. V48 deliberately binds up to four **ready and integrity-verified** stored files to one authenticated project chat turn; it does not automatically expose project files to the model.

## User-visible behavior

- Open the Research files panel in Genithm chat, refresh the current project's library, select up to four ready files, and submit an ordinary text message. The ordinary sequence/image attachment path is unchanged.
- The application obtains the signed, checksum-sealed file reports from the authenticated API, not from browser-supplied summaries. SQL rechecks the caller, ownership, project and organization, ready state, full-byte checksum status, report identity and object evidence. It inserts the chat turn and stores a compact file evidence snapshot atomically.
- The model receives only the SQL-authorized, bounded **aggregate metrics**, source size, format and digests. It receives no FASTA/FASTQ bodies, private read IDs, archived script contents or scientific inference about opaque formats. An inert (bytes-only) file is explicitly labelled as unanalysed.
- Evidence-turn responses are withheld until a complete response has been received and saved. Truncated provider output and unsolicited tool calls fail closed. Ordinary chat preserves its previous streaming and scientific planning behavior.
- The Data file library adds an original-file download for verified, available objects: the authenticated API rechecks the full report and S3 HEAD metadata, then issues a **120-second, private GET** signed for the server-derived quarantine key. The source bypasses the application server; client may verify the published SHA-256 independently. This is not malware scanning.

## Security and operational boundaries

Authorization never depends on selected IDs or file-report JSON supplied by the browser. No user-created project is granted capacity or deployed workers by this release. The change does not enable the existing offline large-file service: matching hosted web, API, private storage, permissions, project capacity, and V47-capable worker are required for users to upload new files.

SQL migration `20261019150714_chat_file_evidence_v48.sql` is additive (bounded column and owner-scoped RPC). The SQL RPC is accessible only by authenticated users and reuses the existing rate-limited, transactionally authorized chat-turn creation. The original-download API continues to use service-role-only file lookups. Every project-switch clears the in-flight file selection.

## Verification

Tests include authenticated download, authorization failures, stale ETag, changed report, valid/invalid private report records, duplicate selection, and end-to-end source/tenant binding against disposable PostgreSQL in Supabase Local CI. Browser and TypeScript validation must pass before merging. No biological algorithms, downstream aligners, variant callers, or clinical interpretation are added by V48.
