#!/usr/bin/env bash
set -euo pipefail
umask 077
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB_PID="$ROOT/.codespaces-web.pid"
cd "$ROOT"
export GENITHM_CODESPACES_PREVIEW=1

# A listening port is not proof of current source, safe dependencies or loaded keys.
# Never silently reuse an older Next.js process after a checkout/secret update.
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
python3 "$ROOT/scripts/stop_codespaces_web.py"

# Preserve a previously selected full runtime. Sample tools require explicit opt-in.
mode="${GENITHM_CODESPACES_MODE:-}"
if [[ -z "$mode" ]]; then
  if [[ -f "$ROOT/.env.codespaces-preview" ]]; then mode=full; else mode=chat; fi
fi
case "$mode" in
  full) exec bash "$ROOT/scripts/codespaces_preview.sh" ;;
  chat) exec bash "$ROOT/scripts/codespaces_bioai.sh" ;;
  sample) ;;
  *) echo "GENITHM_CODESPACES_MODE must be chat, full or sample."; exit 2 ;;
esac

# Explicit sample-only mode: never described as a configured AI research assistant.
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
