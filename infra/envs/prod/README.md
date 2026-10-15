# Prod

The `jarvis-prod` server: Lightsail in N. Virginia (`us-east-1a`), Ubuntu 24.04, 2 GB RAM, $12/month.

## What gets built

| Thing | Details |
|---|---|
| Lightsail instance | `small_3_0` plan, dual-stack IPv4/IPv6, daily auto-snapshots (last 7 kept) |
| Firewall | Every default rule removed. Only UDP 41641 (Tailscale) is open. |
| Tailscale key | Single-use, pre-approved, tagged `tag:prod`, expires in 1 hour |
| First-boot script | Security updates, auto-updates, Docker, a limited `deploy` user, then joins my tailnet with Tailscale SSH |

## Run it from my PC

Tailscale credentials go in environment variables for the current terminal only. The secret comes from my password manager and is never written to a file.

```powershell
$env:TAILSCALE_OAUTH_CLIENT_ID = "<client id>"
$env:TAILSCALE_OAUTH_CLIENT_SECRET = [System.Net.NetworkCredential]::new("", (Read-Host "Tailscale OAuth secret" -AsSecureString)).Password
terraform init -backend-config=backend.hcl
terraform plan -out=prod.tfplan
terraform apply prod.tfplan
```

`backend.hcl` is gitignored. Copy it from `backend.hcl.example` and fill in the bucket name from the bootstrap outputs.

## After apply

Give it about 3 minutes to boot and finish setup, then check:

```powershell
tailscale status
ssh ubuntu@jarvis-prod
```

Later, deploys come from GitHub Actions instead of my PC.
