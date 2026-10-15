# Changelog

## 2026-10-15

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
