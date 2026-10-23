#!/usr/bin/env bash
set -euo pipefail
umask 077
export GENITHM_GEMINI_MODEL="${GENITHM_GEMINI_MODEL:-gemini-3.8-flash}"
export GENITHM_GROQ_MODEL="${GENITHM_GROQ_MODEL:-openai/gpt-oss-120b}"

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

# Stop stale Next.js before any setup failure or node_modules replacement.
python3 "$ROOT_DIR/scripts/stop_codespaces_web.py"

required=(SUPABASE_SECRET_KEY GEMINI_API_KEY GROQ_API_KEY)
missing=()
for name in "${required[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    missing+=("$name")
  fi
done
if (( ${#missing[@]} > 0 )); then
  echo "Missing Codespaces secrets: ${missing[*]}"
  echo "Add the required repository Codespaces secrets, STOP and START the Codespace, then run this command again. Actions secrets are separate."
  exit 2
fi

for tool in npm curl python3 base64 od head tr grep git; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "Required tool is missing: $tool"
    exit 3
  fi
done

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is not installed in this Codespace container."
  echo "The Genithm full preview needs the Docker-in-Docker devcontainer feature."
  echo "First update main: git pull --ff-only"
  echo "Then use VS Code Command Palette > Codespaces: Rebuild Container."
  echo "If rebuild is unavailable, create a new Codespace from main."
  echo "For authenticated AI chat without Docker: bash scripts/codespaces_bioai.sh"
  exit 3
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker CLI is installed but the Docker daemon is not responding."
  echo "Restart or rebuild the Codespace container and retry:"
  echo "  docker info"
  echo "If it remains unavailable, inspect the Docker-in-Docker devcontainer startup log."
  echo "For authenticated chat without the worker fleet: bash scripts/codespaces_bioai.sh"
  exit 3
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose v2 is unavailable; the full Genithm preview requires docker compose."
  echo "Update main and rebuild the Codespace container to install the Docker-in-Docker feature."
  exit 3
fi

SUPABASE_URL="https://vowmjjgkjoxcvlfamukh.supabase.co"
SUPABASE_PUBLISHABLE_KEY="sb_publishable_uuFaIXmkIG2PpCDMD3Jd4w_jXkMc-Qt"
WEB_ORIGIN="https://${CODESPACE_NAME}-3000.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}"
STORAGE_ORIGIN="https://${CODESPACE_NAME}-9000.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}"
NCBI_EMAIL="${NCBI_EMAIL:-genithmai@gmail.com}"
# Signed, multi-arch classic SILO build (S3 API + bundled mcli), used only in Codespaces.
GENITHM_PREVIEW_STORAGE_IMAGE="docker.io/pgsty/silo:RELEASE.2026-09-16T00-00-00Z@sha256:635197cb9f36d01bee221d34d1c7d7960f6a95c48b0b6c01d99cd13bdae51a46"
GENITHM_SCIENTIFIC_CONCURRENCY="${GENITHM_SCIENTIFIC_CONCURRENCY:-1}"
if [[ ! "$GENITHM_SCIENTIFIC_CONCURRENCY" =~ ^[1-4]$ ]]; then
  echo "GENITHM_SCIENTIFIC_CONCURRENCY must be an integer from 1 to 4."
  exit 2
fi
GENITHM_PREVIEW_STORAGE_ACCESS_KEY="genithmpreview"
GENITHM_PREVIEW_STORAGE_SECRET_KEY="$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"
GENITHM_AUDIT_SIGNING_PRIVATE_KEY_BASE64="$(head -c 32 /dev/urandom | base64 | tr -d '\n')"
HEAD_SHA="$(git -C "$ROOT_DIR" rev-parse HEAD)"
# Development must not combine current web code with an obsolete V1 candidate.
RUNTIME_SHA="${GENITHM_PREVIEW_RUNTIME_SHA:-$HEAD_SHA}"
if [[ "$RUNTIME_SHA" != "$HEAD_SHA" ]]; then
  echo "Development runtime must match the checked-out source revision."
  echo "Unset GENITHM_PREVIEW_RUNTIME_SHA or check out that revision first."
  exit 4
fi

if [[ ! "$RUNTIME_SHA" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Could not resolve a valid coordinated V1 runtime revision."
  exit 4
fi
if ! git -C "$ROOT_DIR" merge-base --is-ancestor "$RUNTIME_SHA" "$HEAD_SHA"; then
  echo "Resolved runtime revision $RUNTIME_SHA is not an ancestor of the checked-out commit $HEAD_SHA."
  exit 4
fi

GENITHM_API_IMAGE="ghcr.io/genithm/genithm-api:sha-$RUNTIME_SHA"
GENITHM_SEQUENCE_WORKER_IMAGE="ghcr.io/genithm/genithm-sequence-worker:sha-$RUNTIME_SHA"
GENITHM_SOURCE_WORKER_IMAGE="ghcr.io/genithm/genithm-source-worker:sha-$RUNTIME_SHA"
GENITHM_BLAST_WORKER_IMAGE="ghcr.io/genithm/genithm-blast-worker:sha-$RUNTIME_SHA"
GENITHM_SCIENTIFIC_WORKER_IMAGE="ghcr.io/genithm/genithm-scientific-worker:sha-$RUNTIME_SHA"
GENITHM_AUDIT_WORKER_IMAGE="ghcr.io/genithm/genithm-audit-worker:sha-$RUNTIME_SHA"
GENITHM_AI_WORKER_IMAGE="ghcr.io/genithm/genithm-ai-worker:sha-$RUNTIME_SHA"

echo "Checking Gemini and Groq model availability..."
python3 "$ROOT_DIR/scripts/check_ai_provider_models.py" --inference

cat > "$ENV_FILE" <<EOF
SUPABASE_URL=$SUPABASE_URL
SUPABASE_PUBLISHABLE_KEY=$SUPABASE_PUBLISHABLE_KEY
SUPABASE_SECRET_KEY=$SUPABASE_SECRET_KEY
GEMINI_API_KEY=$GEMINI_API_KEY
GROQ_API_KEY=$GROQ_API_KEY
GENITHM_GEMINI_MODEL=$GENITHM_GEMINI_MODEL
GENITHM_GROQ_MODEL=$GENITHM_GROQ_MODEL
NCBI_EMAIL=$NCBI_EMAIL
NCBI_API_KEY=${NCBI_API_KEY:-}
GENITHM_PREVIEW_WEB_ORIGIN=$WEB_ORIGIN
GENITHM_PREVIEW_STORAGE_IMAGE=$GENITHM_PREVIEW_STORAGE_IMAGE
GENITHM_PREVIEW_STORAGE_PUBLIC_ENDPOINT=$STORAGE_ORIGIN
GENITHM_PREVIEW_STORAGE_ACCESS_KEY=$GENITHM_PREVIEW_STORAGE_ACCESS_KEY
GENITHM_PREVIEW_STORAGE_SECRET_KEY=$GENITHM_PREVIEW_STORAGE_SECRET_KEY
GENITHM_R2_SEQUENCE_BUCKET=genithm-preview-sequences
GENITHM_AUDIT_SIGNING_KEY_ID=codespaces-preview-ed25519
GENITHM_AUDIT_SIGNING_PRIVATE_KEY_BASE64=$GENITHM_AUDIT_SIGNING_PRIVATE_KEY_BASE64
GENITHM_API_IMAGE=$GENITHM_API_IMAGE
GENITHM_SEQUENCE_WORKER_IMAGE=$GENITHM_SEQUENCE_WORKER_IMAGE
GENITHM_SOURCE_WORKER_IMAGE=$GENITHM_SOURCE_WORKER_IMAGE
GENITHM_BLAST_WORKER_IMAGE=$GENITHM_BLAST_WORKER_IMAGE
GENITHM_SCIENTIFIC_WORKER_IMAGE=$GENITHM_SCIENTIFIC_WORKER_IMAGE
GENITHM_SCIENTIFIC_CONCURRENCY=$GENITHM_SCIENTIFIC_CONCURRENCY
GENITHM_AUDIT_WORKER_IMAGE=$GENITHM_AUDIT_WORKER_IMAGE
GENITHM_AI_WORKER_IMAGE=$GENITHM_AI_WORKER_IMAGE
EOF
chmod 600 "$ENV_FILE"

if command -v gh >/dev/null 2>&1; then
  gh codespace ports visibility 9000:public -c "$CODESPACE_NAME" >/dev/null 2>&1 || true
fi

echo "Checking Supabase Auth settings..."
AUTH_SETTINGS="$(curl -fsS -H "apikey: $SUPABASE_PUBLISHABLE_KEY" "$SUPABASE_URL/auth/v1/settings")"
if ! printf '%s' "$AUTH_SETTINGS" | grep -Eq '"disable_signup"[[:space:]]*:[[:space:]]*false'; then
  echo "Supabase signup is disabled. Enable new-user signup before using this preview."
  exit 4
fi
if ! printf '%s' "$AUTH_SETTINGS" | grep -Eq '"email"[[:space:]]*:[[:space:]]*true'; then
  echo "Supabase email authentication is disabled. Enable the email provider before using signup/login."
  exit 4
fi

echo "Checking coordinated preview runtime images for revision $RUNTIME_SHA..."
if [[ "$RUNTIME_SHA" != "$HEAD_SHA" ]]; then
  echo "Web source is $HEAD_SHA; backend runtime uses the latest coordinated V1 candidate $RUNTIME_SHA."
fi

runtime_images=(
  "$GENITHM_API_IMAGE"
  "$GENITHM_SEQUENCE_WORKER_IMAGE"
  "$GENITHM_SOURCE_WORKER_IMAGE"
  "$GENITHM_BLAST_WORKER_IMAGE"
  "$GENITHM_SCIENTIFIC_WORKER_IMAGE"
  "$GENITHM_AUDIT_WORKER_IMAGE"
  "$GENITHM_AI_WORKER_IMAGE"
)
runtime_contexts=(api sequence-worker source-worker blast-worker scientific-worker audit-worker ai-worker)
for index in "${!runtime_images[@]}"; do
  image="${runtime_images[$index]}"
  if ! docker pull "$image" >/dev/null 2>&1; then
    # Development-only fallback: build exactly this checkout, never an older image.
    # Dockerfiles COPY application files explicitly; no keys are build arguments.
    echo "Building current development source for ${runtime_contexts[$index]}..."
    docker build --label "org.opencontainers.image.revision=$HEAD_SHA" \
      --tag "$image" "$ROOT_DIR/apps/${runtime_contexts[$index]}"
  fi
done

echo "Checking pinned temporary S3 preview storage image..."
if ! docker pull "$GENITHM_PREVIEW_STORAGE_IMAGE"; then
  echo "Cannot pull the pinned S3-compatible Codespaces storage image."
  echo "Check Docker Hub availability and Codespaces network access."
  echo "This preview deliberately does not use quay.io/minio/minio or quay.io/minio/mc."
  exit 4
fi

echo "Preparing web dependencies..."
(
  cd "$WEB_DIR"
  npm ci
)
node "$ROOT_DIR/scripts/check_web_runtime.mjs"
rm -rf -- "$WEB_DIR/.next"

echo "Starting Genithm API, six workers, and preview object storage..."
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --remove-orphans --pull never

cat > "$WEB_DIR/.env.local" <<EOF
NEXT_PUBLIC_SUPABASE_URL=$SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$SUPABASE_PUBLISHABLE_KEY
NEXT_PUBLIC_GENITHM_API_URL=/genithm-api
GENITHM_LOCAL_API_PROXY_TARGET=http://127.0.0.1:8000
GENITHM_APP_URL=$WEB_ORIGIN
SUPABASE_SECRET_KEY=$SUPABASE_SECRET_KEY
GEMINI_API_KEY=$GEMINI_API_KEY
GROQ_API_KEY=$GROQ_API_KEY
GENITHM_GEMINI_MODEL=$GENITHM_GEMINI_MODEL
GENITHM_GROQ_MODEL=$GENITHM_GROQ_MODEL
GENITHM_SCIENCE_V22_ENABLED=true
EOF
chmod 600 "$WEB_DIR/.env.local"

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

echo "Checking six worker heartbeats and queue readiness..."
READINESS_JSON=""
for _ in $(seq 1 60); do
  READINESS_JSON="$(curl -fsS -X POST     -H "apikey: $SUPABASE_SECRET_KEY"     -H "Content-Type: application/json"     "$SUPABASE_URL/rest/v1/rpc/get_release_readiness"     -d '{}' || true)"
  if printf '%s' "$READINESS_JSON" | grep -Eq '"status"[[:space:]]*:[[:space:]]*"ready"'; then
    break
  fi
  sleep 2
done

if ! printf '%s' "$READINESS_JSON" | grep -Eq '"status"[[:space:]]*:[[:space:]]*"ready"'; then
  echo "Genithm runtime did not become fully ready."
  echo "Supabase readiness: $READINESS_JSON"
  echo
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps
  exit 4
fi

echo
echo "Genithm FULL preview is running and passed readiness checks."
echo "Open your real sign-in page: $WEB_ORIGIN/login"
echo "Create an account: $WEB_ORIGIN/signup"
echo "Open the application: $WEB_ORIGIN"
echo "The /preview workbench is an OPTIONAL sample-only development route, not the main research app."
echo "Supabase Auth is reachable, API/web health checks passed, and all six worker heartbeats are current."
echo "Google AI Studio and Groq is configured as the preview AI provider."
echo "Runtime images are coordinated from V1 candidate revision: $RUNTIME_SHA"
echo "Preview object storage is temporary and isolated to this Codespace."
echo
echo "Useful commands:"
echo "  docker compose --env-file .env.codespaces-preview -f deploy/codespaces/docker-compose.preview.yml ps"
echo "  tail -f .codespaces-web.log"
