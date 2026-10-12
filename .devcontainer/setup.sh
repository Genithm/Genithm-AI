#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "[Genithm] Installing locked Next.js dependencies..."
node --version
npm --version
npm --prefix apps/web ci --no-fund

echo "[Genithm] Checking scientific algorithms without external services..."
python3 scripts/codespaces-science-smoke.py

echo "[Genithm] Codespaces ready. Port 3000 starts automatically on container start."
echo "[Genithm] Public preview: /preview (no Supabase configuration needed)."
echo "[Genithm] Signed-in research features require a separate development Supabase project."
