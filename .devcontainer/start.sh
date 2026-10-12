#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if curl -fsS --max-time 2 http://127.0.0.1:3000/ > /dev/null 2>&1; then
  echo "[Genithm] Web preview is already running on port 3000."
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
)
echo "[Genithm] Use Codespaces PORTS tab → Genithm AI preview → Open in Browser."
echo "[Genithm] Development logs: tail -f /tmp/genithm-codespaces-web.log"
