#!/usr/bin/env bash
set -euo pipefail
umask 077
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB_PID="$ROOT/.codespaces-web.pid"
cd "$ROOT"
export GENITHM_CODESPACES_PREVIEW=1

if [[ -z "${CODESPACE_NAME:-}" || -z "${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-}" ]]; then
  echo "Run this startup inside GitHub Codespaces."
  exit 2
fi
for binary in python3 node npm curl; do
  if ! command -v "$binary" >/dev/null 2>&1; then
    echo "[Genithm] Missing $binary. Rebuild the Codespace container."
    exit 3
  fi
done

# A leftover environment file is not proof that the full Docker fleet is ready.
# Open the real web app by default; full scientific execution remains explicit.
mode="${GENITHM_CODESPACES_MODE:-chat}"
case "$mode" in
  chat|full|sample) ;;
  *) echo "GENITHM_CODESPACES_MODE must be chat, full or sample."; exit 2 ;;
esac

recover() {
  local status=$?
  trap - EXIT
  if (( status != 0 )); then
    local reason=startup
    if (( status == 2 )); then reason=configuration; fi
    python3 "$ROOT/scripts/stop_codespaces_web.py" || true
    python3 "$ROOT/scripts/codespaces_recovery.py" --start --reason "$reason" || true
    echo "[Genithm] Startup failed (exit $status). The recovery page is not application readiness."
  fi
  exit "$status"
}
trap recover EXIT
python3 "$ROOT/scripts/stop_codespaces_web.py"
case "$mode" in
  full) bash "$ROOT/scripts/codespaces_preview.sh"; exit 0 ;;
  chat) bash "$ROOT/scripts/codespaces_bioai.sh"; exit 0 ;;
  sample) ;;
esac

npm --prefix apps/web ci --no-fund
node "$ROOT/scripts/check_web_runtime.mjs"
rm -rf -- "$ROOT/apps/web/.next"
if ! curl -fsS --max-time 2 http://127.0.0.1:8769/health >/dev/null 2>&1; then
  nohup python3 scripts/codespaces-live-science-server.py > /tmp/genithm-codespaces-science.log 2>&1 < /dev/null &
fi
(
  cd apps/web
  nohup npm run dev -- --hostname 0.0.0.0 --port 3000 > "$ROOT/.codespaces-web.log" 2>&1 < /dev/null &
  echo $! > "$WEB_PID"
)
echo "[Genithm] Explicit sample-only workbench starting at /preview; this does not configure AI chat."
echo "[Genithm] For the real assistant: bash scripts/codespaces_bioai.sh"
