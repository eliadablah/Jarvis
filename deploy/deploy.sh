#!/usr/bin/env bash
# Deploys one image tag of the Jarvis web app to one server over Tailscale.
# Runs on the GitHub Actions runner after it has joined the tailnet as tag:ci.
#
# Usage: deploy.sh <tailscale-hostname> <app-env> <image-tag>
#   e.g. deploy.sh jarvis-dev dev 3f2a1b9
#
# Needs GHCR_USER and GHCR_TOKEN in the environment: a short-lived token the
# server uses once to pull the image, then logs out again.
set -euo pipefail

host="$1"
app_env="$2"
image_tag="$3"
: "${GHCR_USER:?GHCR_USER is required}"
: "${GHCR_TOKEN:?GHCR_TOKEN is required}"

# Resolve the server's Tailscale address (CI may not use MagicDNS names).
ip="$(tailscale ip -4 "$host")"
target="deploy@$ip"
ssh_opts=(-o StrictHostKeyChecking=accept-new -o ConnectTimeout=20)

echo "Deploying jarvis-web:$image_tag to $host ($ip) as $app_env"

# --- 1. Ship the compose file ---
ssh "${ssh_opts[@]}" "$target" "mkdir -p ~/jarvis"
ssh "${ssh_opts[@]}" "$target" "cat > ~/jarvis/compose.yaml" < deploy/compose.yaml

# --- 2. Pull the new image (log in only for the pull) and restart ---
printf '%s' "$GHCR_TOKEN" | ssh "${ssh_opts[@]}" "$target" \
  "docker login ghcr.io -u '$GHCR_USER' --password-stdin >/dev/null"

ssh "${ssh_opts[@]}" "$target" bash -s <<EOF
set -euo pipefail
cd ~/jarvis
export IMAGE_TAG='$image_tag' APP_ENV='$app_env'
trap 'docker logout ghcr.io >/dev/null 2>&1 || true' EXIT
docker compose pull
docker compose up -d --remove-orphans
docker image prune -f >/dev/null
EOF

# --- 3. Health check from the server itself (CI can only reach port 22) ---
for attempt in $(seq 1 15); do
  if body="$(ssh "${ssh_opts[@]}" "$target" "curl -fsS http://127.0.0.1/healthz")"; then
    echo "Health check passed: $body"
    if [[ "$body" == *"\"version\":\"$image_tag\""* ]]; then
      echo "Deploy verified: $host is running $image_tag"
      exit 0
    fi
    echo "Server answered but with the wrong version, retrying"
  fi
  sleep 4
done

echo "Deploy failed: $host never reported version $image_tag" >&2
ssh "${ssh_opts[@]}" "$target" "cd ~/jarvis && docker compose ps && docker compose logs --tail 50" || true
exit 1
