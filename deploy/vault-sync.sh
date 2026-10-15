#!/bin/sh
# Keeps a read-only copy of my Obsidian vault on the server, for Jarvis to
# read. Runs forever inside the vault-sync container: clone once, then
# fetch every SYNC_INTERVAL seconds and match GitHub exactly.
#
# The key is a read-only deploy key for the private jarvis-vault repo, and
# GitHub's host keys are pinned, so the server can only ever read that one
# repo, and only from the real GitHub.
set -eu

repo="git@github.com:eliadablah/jarvis-vault.git"
dir="/vault"
interval="${SYNC_INTERVAL:-300}"

export GIT_SSH_COMMAND="ssh -i /run/vault/key -o IdentitiesOnly=yes \
  -o StrictHostKeyChecking=yes -o UserKnownHostsFile=/run/vault/known_hosts"

sync_once() {
  if [ -d "$dir/.git" ]; then
    git -C "$dir" fetch --quiet --depth 1 origin main
    git -C "$dir" reset --quiet --hard origin/main
    git -C "$dir" clean --quiet -fdx
  else
    # The volume may hold leftovers from a failed first clone.
    find "$dir" -mindepth 1 -delete
    git clone --quiet --depth 1 --branch main "$repo" "$dir"
  fi
  echo "vault-sync: at $(git -C "$dir" log -1 --format='%h %cI')"
}

while true; do
  sync_once || echo "vault-sync: sync failed, retrying in ${interval}s"
  sleep "$interval"
done
