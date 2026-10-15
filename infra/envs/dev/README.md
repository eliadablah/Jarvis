# Dev

The `jarvis-dev` test server. Same blueprint as prod, smaller and temporary.

| | Dev | Prod |
|---|---|---|
| Name | `jarvis-dev` | `jarvis-prod` |
| Plan | `micro_3_0`: 1 GB RAM, $7/month | `small_3_0`: 2 GB RAM, $12/month |
| Tailscale tag | `tag:dev` | `tag:prod` |
| Snapshots | Off | Daily, last 7 kept |
| Lifetime | Built to test, destroyed after | Always on |

Lightsail bills by the hour, so a dev server that lives for an afternoon of testing costs a few cents.

## Test a change

From this folder:

```powershell
$env:TAILSCALE_OAUTH_CLIENT_ID = "<client id>"
$env:TAILSCALE_OAUTH_CLIENT_SECRET = [System.Net.NetworkCredential]::new("", (Read-Host "Tailscale OAuth secret" -AsSecureString)).Password
terraform init -backend-config=backend.hcl
terraform plan -out=dev.tfplan
terraform apply dev.tfplan
```

Wait about 3 minutes for first boot, then check:

```powershell
tailscale status
ssh ubuntu@jarvis-dev
```

## Tear it down

```powershell
terraform destroy
```

Then remove `jarvis-dev` from the Tailscale Machines page, since destroying the server doesn't sign it out of the tailnet.
