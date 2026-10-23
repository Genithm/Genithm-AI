# Codespaces HTTP 502 recovery

HTTP 502 at the forwarded port does not identify the underlying failure by itself.
Check the local listener first. A stopped Codespace, failed startup, an exited web
process or the wrong forwarding protocol can make the external URL unavailable.

The V51 automatic boot stopped the server before live provider checks, and selected
the full Docker fleet merely because a generated environment file existed. Those
paths could leave no listener even though the source and unit tests were correct.

## Apply the repair

In the Codespaces terminal, from the repository root:

```bash
git switch main && git pull --ff-only && GENITHM_CODESPACES_MODE=chat bash .devcontainer/start.sh
```

Open the application only after the terminal reports that its web health check
passed. In the Ports panel select port 3000, Change Port Protocol, HTTP. The external
browser URL remains HTTPS and the port should remain private.

V52 defaults to the real chat web app, not the sample workbench or the full worker
fleet. An old `.env.codespaces-preview` does not activate Docker. Provider inference
checks run after the web server becomes ready; account failures are reported but do
not terminate the UI. This does not mean AI inference passed. Jobs and scientific
execution still require their separately validated backend and approval.

For the complete scientific environment explicitly select:

```bash
GENITHM_CODESPACES_MODE=full bash .devcontainer/start.sh
```

If startup fails, the standard startup wrapper tries to provide a read-only recovery
screen on port 3000. It contains only fixed guidance, no environment values, logs,
request contents or interactive command execution. Its `/api/health` is HTTP 503
with `status=setup_required`, never an application-ready result. The original
startup exit code is preserved. It will not replace an unrelated listener.

If the forwarding link still fails, test from the Codespaces terminal:

```bash
curl --max-time 10 -i http://127.0.0.1:3000/api/health
```

Connection refused means no local listener. A healthy local response with an
external 502 calls for checking HTTP port forwarding and re-forwarding port 3000,
not changing the API keys. A recovery response means startup failed; inspect the
specific terminal error. Do not publish raw logs or secret values.

Keys remain Codespaces secrets: GEMINI_API_KEY, GROQ_API_KEY, SUPABASE_SECRET_KEY.
Restart the Codespace after changing them. Source edits do not restart a private
Codespace automatically; repository checks do not validate the private accounts.
