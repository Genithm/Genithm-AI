# V51: stale server and AI configuration recovery

Seeing Next.js 16.4.0 after updating main means the installed/running application
has not necessarily caught up with the repository, which pins Next.js 16.4.2 and
sharp 0.35.5. Do not disable the framework security insight to hide this problem.

## Existing Codespace recovery

Stop and start the Codespace after adding or changing Codespaces secrets. In the
Codespace TERMINAL (not the Genithm bioinformatics chat), from the repository root:

```bash
git switch main && git pull --ff-only && bash .devcontainer/start.sh
```

This preserves uncommitted work: Git will refuse an unsafe checkout or non-fast-forward
update instead of resetting the workspace. Resolve any such Git error before startup.

The startup script defaults to real authenticated chat. When a prior full preview
configuration exists, it preserves full API/worker startup. Set
`GENITHM_CODESPACES_MODE=chat` or `full` to choose explicitly. Sample-only tools now
require explicit `GENITHM_CODESPACES_MODE=sample`; they are not an AI fallback.

Both real launchers require `GEMINI_API_KEY`, `GROQ_API_KEY`, and
`SUPABASE_SECRET_KEY` in repository Settings > Secrets and variables > Codespaces.
Actions secrets and Codespaces secrets are separate. Never paste keys into chat,
commit them, or put them in NEXT_PUBLIC variables. New secrets are available only
after stopping and starting the Codespace. A browser refresh is not sufficient.

Startup stops only owned Next.js dev/start processes from this checkout, refuses
to kill unrelated port users, reinstalls locked dependencies, verifies installed
Next/sharp versions, clears generated .next cache, and launches a fresh process.
The existing account preflight tests both Gemini and Groq independently. It can
fail for invalid credentials, quota, unavailable models or a network issue; passing
unit tests does not mean the private accounts have passed this live test.

`npm run dev`, `npm start`, and `npm run build` also validate the installed versions.
The check prints approved installed versions but never prints credential values.
An explicit raw `next` command bypasses npm lifecycle hooks and should not be used
to work around the version guard.

A coding-agent upgrade prompt belongs in a development terminal or coding agent,
not Genithm's scientific chat. Genithm does not authorize arbitrary shell commands
or changes to its own source from a research conversation.
