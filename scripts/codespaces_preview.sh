#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/deploy/codespaces/docker-compose.preview.yml"
ENV_FILE="$ROOT_DIR/.env.codespaces-preview"
WEB_DIR="$ROOT_DIR/apps/web"
WEB_LOG="$ROOT_DIR/.codespaces-web.log"
WEB_PID="$ROOT_DIR/.codespaces-web.pid"

if [[ -z "${CODESPACE_NAME:-}" || -z "${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-}" ]]; then
  echo "This launcher is intended to run inside GitHub Codespaces."
  exit 1
fi

required=(SUPABASE_SECRET_KEY DEEPSEEK_API_KEY)
missing=()
for name in "${required[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    missing+=("$name")
  fi
done
if (( ${#missing[@]} > 0 )); then
  echo "Missing Codespaces secrets: ${missing[*]}"
  echo "Add the required repository Codespaces secrets, restart the Codespace, then run this command again."
  exit 2
fi

for tool in docker npm curl base64 od head tr; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "Required tool is missing: $tool"
    echo "Rebuild the Codespace container from main, then run this command again."
    exit 3
  fi
done

SUPABASE_URL="https://vowmjjgkjoxcvlfamukh.supabase.co"
SUPABASE_PUBLISHABLE_KEY="sb_publishable_uuFaIXmkIG2PpCDMD3Jd4w_jXkMc-Qt"
WEB_ORIGIN="https://${CODESPACE_NAME}-3000.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}"
STORAGE_ORIGIN="https://${CODESPACE_NAME}-9000.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}"
NCBI_EMAIL="${NCBI_EMAIL:-genithmai@gmail.com}"
GENITHM_PREVIEW_STORAGE_ACCESS_KEY="genithmpreview"
GENITHM_PREVIEW_STORAGE_SECRET_KEY="$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"
GENITHM_AUDIT_SIGNING_PRIVATE_KEY_BASE64="$(head -c 32 /dev/urandom | base64 | tr -d '\n')"

cat > "$ENV_FILE" <<EOF
SUPABASE_URL=$SUPABASE_URL
SUPABASE_PUBLISHABLE_KEY=$SUPABASE_PUBLISHABLE_KEY
SUPABASE_SECRET_KEY=$SUPABASE_SECRET_KEY
DEEPSEEK_API_KEY=$DEEPSEEK_API_KEY
NCBI_EMAIL=$NCBI_EMAIL
NCBI_API_KEY=${NCBI_API_KEY:-}
GENITHM_PREVIEW_WEB_ORIGIN=$WEB_ORIGIN
GENITHM_PREVIEW_STORAGE_PUBLIC_ENDPOINT=$STORAGE_ORIGIN
GENITHM_PREVIEW_STORAGE_ACCESS_KEY=$GENITHM_PREVIEW_STORAGE_ACCESS_KEY
GENITHM_PREVIEW_STORAGE_SECRET_KEY=$GENITHM_PREVIEW_STORAGE_SECRET_KEY
GENITHM_R2_SEQUENCE_BUCKET=genithm-preview-sequences
GENITHM_AUDIT_SIGNING_KEY_ID=codespaces-preview-ed25519
GENITHM_AUDIT_SIGNING_PRIVATE_KEY_BASE64=$GENITHM_AUDIT_SIGNING_PRIVATE_KEY_BASE64
GENITHM_AI_PRIMARY_ENDPOINT=${GENITHM_AI_PRIMARY_ENDPOINT:-https://api.deepseek.com}
GENITHM_AI_PRIMARY_MODEL=${GENITHM_AI_PRIMARY_MODEL:-deepseek-flash}
EOF
chmod 600 "$ENV_FILE"

if command -v gh >/dev/null 2>&1; then
  gh codespace ports visibility 9000:public -c "$CODESPACE_NAME" >/dev/null 2>&1 || true
fi

echo "Preparing web dependencies..."
(
  cd "$WEB_DIR"
  npm ci
)

echo "Starting Genithm API, six workers, and preview object storage..."
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" pull
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --remove-orphans

cat > "$WEB_DIR/.env.local" <<EOF
NEXT_PUBLIC_SUPABASE_URL=$SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$SUPABASE_PUBLISHABLE_KEY
NEXT_PUBLIC_GENITHM_API_URL=/genithm-api
GENITHM_LOCAL_API_PROXY_TARGET=http://127.0.0.1:8000
GENITHM_APP_URL=$WEB_ORIGIN
EOF
chmod 600 "$WEB_DIR/.env.local"

if [[ -f "$WEB_PID" ]] && kill -0 "$(cat "$WEB_PID")" 2>/dev/null; then
  kill "$(cat "$WEB_PID")" || true
fi

(
  cd "$WEB_DIR"
  nohup npm run dev -- --hostname 0.0.0.0 > "$WEB_LOG" 2>&1 &
  echo $! > "$WEB_PID"
)

echo "Checking API health..."
for _ in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:8000/api/v1/health >/dev/null 2>&1; then
    break
  fi
  sleep 2
done
curl -fsS http://127.0.0.1:8000/api/v1/health >/dev/null

echo "Checking web preview..."
for _ in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
    break
  fi
  sleep 2
done
curl -fsS http://127.0.0.1:3000/api/health >/dev/null

echo
echo "Genithm preview is running."
echo "Open: $WEB_ORIGIN"
echo "API and all six workers are connected to the real Supabase project."
echo "DeepSeek is configured as the preview AI provider."
echo "Preview object storage is temporary and isolated to this Codespace."
echo
echo "Useful commands:"
echo "  docker compose --env-file .env.codespaces-preview -f deploy/codespaces/docker-compose.preview.yml ps"
echo "  tail -f .codespaces-web.log"
