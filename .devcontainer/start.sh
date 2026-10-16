#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB_PID="$ROOT/.codespaces-web.pid"
cd "$ROOT"

# This script is only for local Codespaces development, never production.
# Set preview explicitly even in older Codespaces missing remoteEnv settings.
export GENITHM_CODESPACES_PREVIEW=1

if ! curl -fsS --max-time 2 http://127.0.0.1:8769/health > /dev/null 2>&1; then
  echo "[Genithm] Starting private local science engine on loopback port 8769..."
  nohup python3 scripts/codespaces-live-science-server.py > /tmp/genithm-codespaces-science.log 2>&1 < /dev/null &
fi

if curl -fsS --max-time 2 http://127.0.0.1:3000/ > /dev/null 2>&1; then
  echo "[Genithm] Basic development web server is already running on port 3000."
  echo "[Genithm] To test real authenticated Genithm and all six workers, run from repository root: bash scripts/codespaces_preview.sh"
  exit 0
fi

if [ ! -d apps/web/node_modules ]; then
  echo "[Genithm] Web dependencies not installed. Run: bash .devcontainer/setup.sh"
  exit 1
fi

echo "[Genithm] Starting web preview on port 3000..."
(
  cd apps/web
  nohup npm run dev -- --hostname 0.0.0.0 --port 3000 > /tmp/genithm-codespaces-web.log 2>&1 < /dev/null &
  echo $! > "$WEB_PID"
)
echo "[Genithm] Basic workbench running. Open port 3000 → /preview for sample-only tools."
echo "[Genithm] To test the REAL Genithm app with sign-in, Supabase and six workers: bash scripts/codespaces_preview.sh"
echo "[Genithm] Development logs: tail -f /tmp/genithm-codespaces-web.log"
echo "[Genithm] Scientific lab logs: tail -f /tmp/genithm-codespaces-science.log"
