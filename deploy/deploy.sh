#!/usr/bin/env bash
# Deploys one image tag of the Jarvis web app to one server over Tailscale.
# Runs on the GitHub Actions runner after it has joined the tailnet as tag:ci
# and dns-and-cert.sh has left the certificate in ./certs/.
#
# Usage: deploy.sh <tailscale-hostname> <app-env> <image-tag> <domain>
#   e.g. deploy.sh jarvis-dev dev 3f2a1b9 dev-jarvis.eliadablah.com
#
# Needs GHCR_USER and GHCR_TOKEN in the environment: a short-lived token the
# server uses once to pull the image, then logs out again.
# Needs CLAUDE_CODE_OAUTH_TOKEN: the one-year Claude Code login, written to
# a deploy-user-only .env on the server (never into the image or the repo).
# Needs VAULT_DEPLOY_KEY: the read-only key for the private vault repo.
# Optional GEMINI_API_KEY: turns on the Gemini engine, kept in the same .env.
# Optional PERPLEXITY_API_KEY: turns on the Perplexity engine, kept in the same .env.
set -euo pipefail

host="$1"
app_env="$2"
image_tag="$3"
domain="$4"
: "${GHCR_USER:?GHCR_USER is required}"
: "${GHCR_TOKEN:?GHCR_TOKEN is required}"
: "${CLAUDE_CODE_OAUTH_TOKEN:?CLAUDE_CODE_OAUTH_TOKEN is required}"
: "${VAULT_DEPLOY_KEY:?VAULT_DEPLOY_KEY is required}"

# Resolve the server's Tailscale address (CI may not use MagicDNS names).
ip="$(tailscale ip -4 "$host")"
target="deploy@$ip"
ssh_opts=(-o StrictHostKeyChecking=accept-new -o ConnectTimeout=20)

echo "Deploying jarvis-web:$image_tag to $host ($ip) as $app_env at https://$domain"

# --- 1. Ship the compose file, Caddy config, and certificate ---
# Remote paths are single-quoted so ~ expands on the server, not here.
ssh "${ssh_opts[@]}" "$target" 'mkdir -p ~/jarvis/certs && chmod 700 ~/jarvis/certs'
ssh "${ssh_opts[@]}" "$target" 'cat > ~/jarvis/compose.yaml' < deploy/compose.yaml
ssh "${ssh_opts[@]}" "$target" 'cat > ~/jarvis/Caddyfile' < deploy/Caddyfile
ssh "${ssh_opts[@]}" "$target" 'cat > ~/jarvis/certs/fullchain.pem' < certs/fullchain.pem
ssh "${ssh_opts[@]}" "$target" 'umask 077 && cat > ~/jarvis/certs/key.pem' < certs/key.pem
# The token travels over stdin and lands in a file only the deploy user can read.
{
  printf 'CLAUDE_CODE_OAUTH_TOKEN=%s\n' "$CLAUDE_CODE_OAUTH_TOKEN"
  # Optional: the Gemini engine stays off when the secret isn't set.
  if [[ -n "${GEMINI_API_KEY:-}" ]]; then printf 'GEMINI_API_KEY=%s\n' "$GEMINI_API_KEY"; fi
  # Optional: the Perplexity engine stays off when the secret isn't set.
  if [[ -n "${PERPLEXITY_API_KEY:-}" ]]; then printf 'PERPLEXITY_API_KEY=%s\n' "$PERPLEXITY_API_KEY"; fi
  # Optional: lets my PC worker (pc-worker/) collect errands.
  if [[ -n "${PC_WORKER_TOKEN:-}" ]]; then printf 'PC_WORKER_TOKEN=%s\n' "$PC_WORKER_TOKEN"; fi
  # Optional: read-only Google service account (base64 JSON) for the job tracker sheet.
  if [[ -n "${GOOGLE_SERVICE_ACCOUNT_B64:-}" ]]; then printf 'GOOGLE_SERVICE_ACCOUNT_B64=%s\n' "$GOOGLE_SERVICE_ACCOUNT_B64"; fi
} | ssh "${ssh_opts[@]}" "$target" 'umask 077 && cat > ~/jarvis/.env'
# Vault sync: the read-only key, GitHub's pinned host keys, and the script.
printf '%s\n' "$VAULT_DEPLOY_KEY" \
  | ssh "${ssh_opts[@]}" "$target" 'umask 077 && cat > ~/jarvis/vault_key'
ssh "${ssh_opts[@]}" "$target" 'cat > ~/jarvis/github_known_hosts' < deploy/github_known_hosts
ssh "${ssh_opts[@]}" "$target" 'cat > ~/jarvis/vault-sync.sh' < deploy/vault-sync.sh

# --- 2. Pull the new image (log in only for the pull) and restart ---
# The values below are filled in here on the runner on purpose, then sent
# to the server; the token itself travels over stdin, never on a command line.
# shellcheck disable=SC2029
printf '%s' "$GHCR_TOKEN" | ssh "${ssh_opts[@]}" "$target" \
  "docker login ghcr.io -u '$GHCR_USER' --password-stdin >/dev/null"

# shellcheck disable=SC2029
ssh "${ssh_opts[@]}" "$target" \
  "IMAGE_TAG='$image_tag' APP_ENV='$app_env' SITE_ADDRESS='$domain' bash -s" <<'EOF'
set -euo pipefail
cd ~/jarvis
trap 'docker logout ghcr.io >/dev/null 2>&1 || true' EXIT
docker compose pull
docker compose up -d --remove-orphans
# Caddy only reads certificates at start; restart it so a renewed one is used.
docker compose restart proxy
docker image prune -f >/dev/null
EOF

# --- 3. Health check through HTTPS, from the server itself ---
# CI can only reach port 22, so the server checks its own HTTPS name. This
# proves Caddy, the certificate, and the app all work together.
# shellcheck disable=SC2029
for _ in $(seq 1 15); do
  if body="$(ssh "${ssh_opts[@]}" "$target" \
    "curl -fsS --resolve '$domain:443:127.0.0.1' 'https://$domain/healthz'")"; then
    echo "Health check passed: $body"
    if [[ "$body" == *"\"version\":\"$image_tag\""* ]]; then
      echo "Deploy verified: https://$domain is running $image_tag"
      exit 0
    fi
    echo "Server answered but with the wrong version, retrying"
  fi
  sleep 4
done

echo "Deploy failed: https://$domain never reported version $image_tag" >&2
ssh "${ssh_opts[@]}" "$target" 'cd ~/jarvis && docker compose ps && docker compose logs --tail 50' || true
exit 1
