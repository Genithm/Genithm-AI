#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Install web dependencies first. Optional OS scientific tools must never
# block the primary Next.js Codespaces preview.
echo "[Genithm] Installing locked Next.js dependencies..."
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "[Genithm] Node.js/npm is missing. Rebuild the Codespace devcontainer to enable Node 22." >&2
  exit 1
fi
node --version
npm --version
npm --prefix apps/web ci --no-fund

has_science_tools() {
  command -v mafft >/dev/null 2>&1 &&
    { command -v FastTree >/dev/null 2>&1 || command -v fasttree >/dev/null 2>&1; }
}

# Only MSA/phylogeny require these extra binaries. Older or custom Codespace
# images might not have apt-get or package installation privileges.
if ! has_science_tools; then
  echo "[Genithm] Optional MAFFT/FastTree missing; checking available Linux package managers..."
  if command -v apt-get >/dev/null 2>&1; then
    if command -v sudo >/dev/null 2>&1; then
      ( sudo apt-get update -qq &&
        sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends mafft fasttree ) ||
        echo "[Genithm] WARNING: Optional apt installation failed; web preview remains available."
    else
      ( apt-get update -qq &&
        env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends mafft fasttree ) ||
        echo "[Genithm] WARNING: Optional apt installation failed; web preview remains available."
    fi
  elif command -v apk >/dev/null 2>&1; then
    if command -v sudo >/dev/null 2>&1; then
      sudo apk add --no-cache mafft fasttree ||
        echo "[Genithm] WARNING: Optional apk installation failed; web preview remains available."
    else
      apk add --no-cache mafft fasttree ||
        echo "[Genithm] WARNING: Optional apk installation failed; web preview remains available."
    fi
  elif command -v dnf >/dev/null 2>&1; then
    if command -v sudo >/dev/null 2>&1; then
      sudo dnf install -y mafft fasttree ||
        echo "[Genithm] WARNING: Optional dnf installation failed; web preview remains available."
    else
      dnf install -y mafft fasttree ||
        echo "[Genithm] WARNING: Optional dnf installation failed; web preview remains available."
    fi
  else
    echo "[Genithm] WARNING: No supported Linux package manager detected; skipping optional native tools."
  fi
fi

if ! has_science_tools; then
  echo "[Genithm] MAFFT/FastTree analysis requires separate binaries; the web UI and core sequence lab still work."
fi

if command -v python3 >/dev/null 2>&1; then
  echo "[Genithm] Checking local scientific algorithms..."
  python3 scripts/codespaces-science-smoke.py ||
    echo "[Genithm] WARNING: Scientific smoke test failed; check Python before using live analysis."
else
  echo "[Genithm] WARNING: Python 3 not found; the local scientific API will be unavailable."
fi

echo "[Genithm] Codespaces web dependencies installed."
echo "[Genithm] Start: bash .devcontainer/start.sh"
echo "[Genithm] Local SAMPLE workbench: port 3000 → /preview (no credentials; not full Genithm)."
echo "[Genithm] FULL Genithm login/AI/NCBI/API/worker preview: bash scripts/codespaces_preview.sh (requires SUPABASE_SECRET_KEY, GEMINI_API_KEY and GROQ_API_KEY Codespaces secrets)."
