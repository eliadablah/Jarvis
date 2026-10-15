# Changelog

## 2026-10-15

### Test - jarvis-dev end-to-end

- Third `jarvis-dev` build (single-line launch script) joined Tailscale about 2 minutes after creation as `tag:dev`, confirming the launch-script fix.
- Firewall: only UDP 41641 open. `tailscale ping` connected directly through that port (51 ms) instead of through a relay.
- Logged in with `ssh ubuntu@jarvis-dev` over Tailscale SSH, with no SSH port open to the internet.
- `/var/log/jarvis-boot.log` ends with `jarvis boot: finished`; Docker 29.1.3 installed; `deploy` user exists in the `docker` group with no sudo.
- Noted: the updates installed a new kernel, so the server reports "System restart required" after first boot.

### Fix - Single-line launch script

- The second `jarvis-dev` build also never joined Tailscale, even with Tailscale moved first. Both failed scripts started with a `#!/bin/bash` line that does nothing on its own, which fits a known Lightsail + Terraform problem where only the first line of a multi-line launch script runs.
- The boot script now travels base64-encoded inside a single sh-compatible line that unpacks it to a root-only file, runs it with bash, and deletes it.
- Tested in WSL Ubuntu: the launcher is one line, passes `sh -n`, unpacks to a script that passes `bash -n`, with the key, hostname, and tag in place.
- Confirmed by the next build: with the single-line launcher, the server joined Tailscale and the boot script ran to completion.

### Fix - Server first-boot script

- Found on the first `jarvis-dev` build: the server came up with the firewall correct but never joined Tailscale. With every TCP port closed, there was no way in to read the logs.
- The script now joins Tailscale first, so a later failure still leaves the server reachable.
- Waits up to 10 minutes for Ubuntu's own first-boot updates to release the package lock instead of failing (most likely cause of the original failure).
- Keeps existing config files on upgrade instead of stopping at a prompt, and avoids restart prompts.
- Logs everything to `/var/log/jarvis-boot.log`.

### Infra - Tailscale tag ownership

- Tailscale OAuth credentials require every key they create to carry all of the credential's tags, so a credential holding `tag:ci`, `tag:dev`, and `tag:prod` couldn't create a `tag:dev`-only key.
- The credential now holds only `tag:ci`, and the tailnet policy makes `tag:ci` an owner of `tag:dev` and `tag:prod`, so it can create keys for either server.
- Tradeoff: a `tag:ci` device could tag itself `tag:dev` or `tag:prod`. The only `tag:ci` devices are short-lived GitHub Actions runners.

### Docs - Dev to prod release flow

- Rewrote `docs/environments.md` around the dev → prod flow: `dev` branch and `jarvis-dev` for testing, `main` and `jarvis-prod` for daily use, prod changes only through an approved merge.
- README: added a "How I ship changes" section, updated the repo layout, and made the roadmap match what is actually built.

### Infra - Dev environment

- Added `infra/envs/dev`: `jarvis-dev` from the same server module as prod, `micro_3_0` ($7/month, billed hourly), `tag:dev`, no snapshots, built to test and destroyed after.
- Separate state key (`envs/dev/terraform.tfstate`) in the shared bucket.
- Validation: `terraform fmt -check` and `terraform validate` pass. Not applied yet.

### Infra - Prod server (Terraform)

- Added `infra/modules/server`: a Lightsail instance that joins my Tailscale network on first boot with a single-use, 1-hour, `tag:prod` key, then installs security auto-updates, Docker, and a limited `deploy` user.
- Firewall replaces Lightsail's defaults (SSH 22, HTTP 80) with a single rule: Tailscale's UDP 41641. Lightsail requires at least one rule, so "zero ports" isn't possible; no TCP port is open.
- Added `infra/envs/prod`: `jarvis-prod` in `us-east-1a`, `small_3_0` ($12/month), daily auto-snapshots, state in the bootstrap S3 bucket with S3 lock files.
- Tailscale credentials are read from environment variables only.
- Tailnet policy (managed in the Tailscale admin): added `tag:prod` and `tag:ci`, limited the CI robot to SSH on prod, and added policy tests that block saving if the robot could reach my PC or phone.
- Validation: `terraform fmt -check` and `terraform validate` pass. Not applied yet.

### Infra - Terraform bootstrap

- Added `infra/bootstrap`: private, encrypted, versioned S3 bucket for Terraform state, plus two GitHub Actions OIDC roles (read-only `plan`, and `apply` limited to the approval-gated `production` environment).
- Reuses the account's existing GitHub OIDC provider instead of creating a second one.
- Ignored Terraform state, plans, and real `.tfvars` files.
- Validation: `terraform fmt -check`, `terraform validate`, and `terraform plan` pass. Applied: 13 added, 0 changed, 0 destroyed.
- Verified after apply: bucket public access fully blocked, versioning on, apply role trusts only `repo:eliadablah/Jarvis:environment:production`, and existing GitHub deploy roles for other projects untouched.

### Repo - Initial public structure

- Added the README, setup guide, and dev/prod environment plan (`jarvis.eliadablah.com`, reachable only on my private network).
- Added `config/backtalk.json.example` with placeholder paths.
- Added `.gitignore` so the upstream kit folders, real settings, Jarvis's private boot file, and secrets stay out of git.

### Voice - Ask-first permissions

- Changed backtalk `permission_mode` from `bypassPermissions` to `ask`, so Jarvis asks out loud before any real action.
