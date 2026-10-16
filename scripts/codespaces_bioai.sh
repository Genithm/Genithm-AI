#!/usr/bin/env bash
# Launch the REAL authenticated Genithm BioAI chat independently from the
# six-worker Docker science fleet. This is not the /preview sample workbench.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ -z "${CODESPACE_NAME:-}" || -z "${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-}" ]]; then
  echo "Run this launcher inside GitHub Codespaces."
  exit 2
fi

missing=()
for key in SUPABASE_SECRET_KEY OPENROUTER_API_KEY; do
  if [[ -z "${!key:-}" ]]; then missing+=("$key"); fi
done
if (( ${#missing[@]} > 0 )); then
  echo "Missing Codespaces secrets: ${missing[*]}"
  echo "Add them under repository Settings > Secrets and variables > Codespaces, then restart your Codespace."
  exit 2
fi

for binary in npm curl; do
  if ! command -v "$binary" >/dev/null 2>&1; then
    echo "Missing required program: $binary"
    exit 3
  fi
done

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
OPENROUTER_API_KEY=$OPENROUTER_API_KEY
GENITHM_AI_PRIMARY_PROVIDER=openrouter
GENITHM_AI_PRIMARY_MODEL=${GENITHM_AI_PRIMARY_MODEL:-openrouter/free}
GENITHM_SCIENCE_V22_ENABLED=false
EOF
chmod 600 "$WEB_DIR/.env.local"

if [[ ! -d "$WEB_DIR/node_modules" ]]; then
  echo "Installing locked Genithm web dependencies..."
  (cd "$WEB_DIR" && npm ci)
fi

# An automatically started /preview dev server must not retain old env vars.
# Do not run two conflicting Next.js processes on the same Codespace port.
if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  kill "$(cat "$PID_FILE")" >/dev/null 2>&1 || true
fi
if (echo >/dev/tcp/127.0.0.1/3000) >/dev/null 2>&1; then
  if command -v fuser >/dev/null 2>&1; then
    echo "Replacing an older Codespaces port-3000 web process..."
    fuser -k 3000/tcp >/dev/null 2>&1 || true
    sleep 2
  fi
fi
if (echo >/dev/tcp/127.0.0.1/3000) >/dev/null 2>&1; then
  echo "Port 3000 is occupied. Stop the old web server, then rerun this command."
  exit 4
fi

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
echo "MODE: Real authenticated AI chat with OpenRouter and existing Supabase."
echo "Scientific jobs, NCBI retrieval and FASTA uploads are not started by this chat-only launcher."
echo "For the full backend, API, sequence storage and six real workers, use:"
echo "  bash scripts/codespaces_preview.sh"
echo "No development demo or fabricated scientific results are used."
