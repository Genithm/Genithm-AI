#!/usr/bin/env bash
# Launch the REAL authenticated Genithm BioAI chat independently from the
# six-worker Docker science fleet. This is not the /preview sample workbench.
set -euo pipefail
umask 077
export GENITHM_GEMINI_MODEL="${GENITHM_GEMINI_MODEL:-gemini-3.8-flash}"
export GENITHM_GROQ_MODEL="${GENITHM_GROQ_MODEL:-llama-3.3-70b-versatile}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ -z "${CODESPACE_NAME:-}" || -z "${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-}" ]]; then
  echo "Run this launcher inside GitHub Codespaces."
  exit 2
fi

# Stop stale Next.js before any setup failure or node_modules replacement.
python3 "$ROOT/scripts/stop_codespaces_web.py"

missing=()
for key in SUPABASE_SECRET_KEY GEMINI_API_KEY GROQ_API_KEY; do
  if [[ -z "${!key:-}" ]]; then missing+=("$key"); fi
done
if (( ${#missing[@]} > 0 )); then
  echo "Missing Codespaces secrets: ${missing[*]}"
  echo "Add them under repository Settings > Secrets and variables > Codespaces, then STOP and START your Codespace (not only the browser). Actions secrets are separate."
  exit 2
fi

for binary in npm curl python3; do
  if ! command -v "$binary" >/dev/null 2>&1; then
    echo "Missing required program: $binary"
    exit 3
  fi
done

echo "Validating both AI accounts without displaying credentials..."
python3 "$ROOT/scripts/check_ai_provider_models.py" --inference

ORIGIN="https://${CODESPACE_NAME}-3000.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}"
WEB_DIR="$ROOT/apps/web"
PID_FILE="$ROOT/.codespaces-web.pid"
LOG_FILE="$ROOT/.codespaces-web.log"

# Full project URL/publishable key are browser-safe; only backend keys stay
# private in mode-600 .env.local. No second Supabase project is created.
cat > "$WEB_DIR/.env.local" <<EOF
NEXT_PUBLIC_SUPABASE_URL=https://vowmjjgkjoxcvlfamukh.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_uuFaIXmkIG2PpCDMD3Jd4w_jXkMc-Qt
NEXT_PUBLIC_GENITHM_API_URL=/genithm-api
GENITHM_LOCAL_API_PROXY_TARGET=http://127.0.0.1:8000
GENITHM_APP_URL=$ORIGIN
SUPABASE_SECRET_KEY=$SUPABASE_SECRET_KEY
GEMINI_API_KEY=$GEMINI_API_KEY
GROQ_API_KEY=$GROQ_API_KEY
GENITHM_GEMINI_MODEL=$GENITHM_GEMINI_MODEL
GENITHM_GROQ_MODEL=$GENITHM_GROQ_MODEL
GENITHM_SCIENCE_V22_ENABLED=false
EOF
chmod 600 "$WEB_DIR/.env.local"

# Existing Codespaces may still contain dependencies from an older lockfile.
echo "Synchronizing locked Genithm web dependencies..."
(cd "$WEB_DIR" && npm ci)
node "$ROOT/scripts/check_web_runtime.mjs"
rm -rf -- "$WEB_DIR/.next"

echo "Launching real Genithm BioAI chat..."
(
  cd "$WEB_DIR"
  export GENITHM_CODESPACES_PREVIEW=1
  nohup npm run dev -- --hostname 0.0.0.0 --port 3000 > "$LOG_FILE" 2>&1 < /dev/null &
  echo $! > "$PID_FILE"
)

ready=0
for attempt in $(seq 1 50); do
  if curl -fsS --max-time 4 http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
    ready=1
    break
  fi
  if [[ -f "$PID_FILE" ]] && ! kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    break
  fi
  sleep 2
done

if [[ "$ready" != 1 ]]; then
  echo "BioAI web did not start. Inspect .codespaces-web.log in the repository root (redact any secrets before sharing)."
  exit 4
fi

echo
echo "Genithm BioAI chat web is running."
echo "Sign in: $ORIGIN/login"
echo "Create account: $ORIGIN/signup"
echo "Research conversations: $ORIGIN/dashboard/ai"
echo
echo "MODE: Real authenticated AI chat with Google AI Studio and Groq and existing Supabase."
echo "Scientific jobs, NCBI retrieval and FASTA uploads are not started by this chat-only launcher."
echo "For the full backend, API, sequence storage and six real workers, use:"
echo "  bash scripts/codespaces_preview.sh"
echo "No development demo or fabricated scientific results are used."
