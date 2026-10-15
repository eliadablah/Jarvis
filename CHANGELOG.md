# Changelog

## 2026-10-15

### Test - Chat on dev

- Deploy `040101b` succeeded. On `https://dev-jarvis.eliadablah.com`, Jarvis answered in persona and a follow-up question correctly recalled the previous one (same session).
- Refused as designed: a request without the chat header (403), a request from another website's origin (403), and a session ID that looks like a flag (400).

### App - Text chat with Jarvis

- The home page is now a chat: type a message, Jarvis's answer streams in word by word, and follow-up questions continue the same conversation (session ID kept in the browser).
- `POST /api/chat` runs Claude Code headless (`claude -p --output-format stream-json --include-partial-messages`) with the Jarvis persona appended to its system prompt (`app/persona/jarvis.md`).
- Locked down for this first version: `--tools ""` (no built-in tools at all), `--disallowedTools "mcp__*"`, `--permission-mode dontAsk`, `--permission-prompts none`. The message goes in on stdin and the session ID must be a UUID, so neither can inject a command-line flag.
- Requests from other websites are refused: a custom header plus a JSON body forces a CORS preflight the server never grants, and a mismatched `Origin` is rejected. One answer runs at a time; answers stop after 5 minutes or when the browser disconnects.
- Image: Debian slim base (Claude Code ships a glibc binary), Claude Code pinned to the stable release 2.1.292, auto-update and telemetry off. Conversation history lives in a Docker volume.
- Auth: the one-year `claude setup-token` login is stored as GitHub secret `CLAUDE_CODE_OAUTH_TOKEN` and written by the deploy to a deploy-user-only `.env` on the server. It is never in the image or the repo.
- Tests: 24 passing (stream parsing, command-line safety, request checks, routing, config). Local end-to-end run reached Claude Code and displayed its error cleanly (this PC's own Claude Code login had expired); the full answer path gets verified on dev.

### Test - HTTPS on dev

- Deploy `5930e74` succeeded: DNS `dev-jarvis.eliadablah.com -> 100.65.48.56`, new Let's Encrypt certificate valid until 2027-01-13, health check over HTTPS returned the new version.
- `https://dev-jarvis.eliadablah.com` loads with a valid certificate on my tailnet; `http://jarvis-dev` returns 301 to it.
- One more fix along the way: lego's working folder is mounted at `/data`, because `/lego` in its image is the program itself.

### Fix - GitHub identity format and dev domain name

- The first HTTPS deploy failed at "Sign in to AWS": this repo uses GitHub's immutable OIDC subject format (`repo:eliadablah@232940632/Jarvis@1421100534:...`, owner and repo IDs included), but the roles trusted the old `repo:eliadablah/Jarvis:...` format. All three robot roles (plan, apply, dns) now use the immutable prefix, set once in `github_oidc_subject_prefix`.
- Renamed the dev address from `dev.jarvis.eliadablah.com` to `dev-jarvis.eliadablah.com`.
- Applied: 0 added, 4 changed, 0 destroyed.

### Deploy - HTTPS on my own domain

- Each deploy points `dev-jarvis.eliadablah.com` (or `jarvis.eliadablah.com` for prod) at the server's Tailscale address in Route 53. The address changes when dev is rebuilt, so every deploy refreshes it. TTL is 60 seconds.
- `deploy/dns-and-cert.sh`: CI gets a Let's Encrypt certificate with a DNS challenge (lego v4.35.2), stores it in the certificate bucket, and reuses it until it's within 30 days of expiring, so rebuilding dev doesn't hit Let's Encrypt's weekly limits.
- Caddy 2.11.7 runs in front of the app with that certificate; plain HTTP (including `http://jarvis-dev`) redirects to the HTTPS name. The app is no longer published directly.
- The deploy health check now goes through HTTPS on the server, proving Caddy, the certificate, and the app work together.
- The servers still hold no AWS credentials and still have no TCP ports open to the internet.

### Infra - DNS role and certificate bucket

- Bootstrap adds the `jarvis-github-dns` role: only the `dev` and `production` GitHub environments can assume it, and it can only change A and TXT records for the two Jarvis names (plus their `_acme-challenge` records). The other records in the zone are untouched.
- Adds the private, encrypted `jarvis-certs-<account>` bucket for certificates.
- Applied: 6 added, 0 changed, 0 destroyed. GitHub variables added: `AWS_DNS_ROLE_ARN`, `CERT_BUCKET`, `ROUTE53_ZONE_ID`.

### CI/CD - First deploy to dev

- First push with the pipeline deployed `9ac0466` to `jarvis-dev`: health check returned `{"status":"ok","env":"dev","version":"9ac0466"}`, and `http://jarvis-dev` shows the Jarvis page as Dev on my tailnet.
- CI failed only on ShellCheck findings in `deploy/deploy.sh`. Fixed: the remote compose step now uses a quoted heredoc with values passed as environment variables, the intentional runner-side expansions are marked with a reason, and the unused loop variable is gone.

### CI/CD - GitHub Actions pipeline

- `ci.yml`: on every push and pull request to `dev`/`main`, type-check, test, and build the app; `terraform fmt` and `validate` every stack without touching real state; lint the deploy script.
- `deploy.yml`: builds the image (tests run inside the Docker build), pushes it to GHCR tagged with the short commit SHA, then deploys. `dev` branch → `jarvis-dev` automatically; `main` → `jarvis-prod` after approval in the `production` environment.
- `deploy/deploy.sh`: joins nothing itself; runs after the runner joins Tailscale as `tag:ci`, SSHes in as `deploy`, ships the compose file, logs in to GHCR only for the pull, restarts the app, and checks `/healthz` until it reports the new version.
- GitHub setup: repo variable `TS_OAUTH_CLIENT_ID`; environments `dev` (no gate) and `production` (requires my approval).
- `.gitattributes` keeps Linux line endings on scripts and YAML.
- Checked locally: deploy script passes `bash -n`; workflow and compose files parse as YAML. First real run happens on the next push.

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
