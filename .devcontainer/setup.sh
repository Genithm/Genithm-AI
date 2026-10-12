#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if ! command -v mafft >/dev/null 2>&1 || { ! command -v FastTree >/dev/null 2>&1 && ! command -v fasttree >/dev/null 2>&1; }; then
  echo "[Genithm] Installing Codespaces MAFFT/FastTree scientific executables..."
  sudo apt-get update -qq
  sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends mafft fasttree
fi

echo "[Genithm] Installing locked Next.js dependencies..."
node --version
npm --version
npm --prefix apps/web ci --no-fund

echo "[Genithm] Checking scientific algorithms without external services..."
python3 scripts/codespaces-science-smoke.py

echo "[Genithm] Codespaces ready. Private web and local scientific engine start on container boot."
echo "[Genithm] Public preview: /preview (no Supabase configuration needed)."
echo "[Genithm] Signed-in research features require a separate development Supabase project."
