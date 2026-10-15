# Environments: dev and prod

I run two copies of Jarvis's server so I can test a change before it touches the one I rely on. Dev is the test kitchen; prod is the dining room.

Both servers are built from the same Terraform blueprint (`infra/modules/server`), so if something works on dev, prod gets built exactly the same way.

| | Dev | Prod |
|---|---|---|
| Git branch | `dev` | `main` |
| Terraform folder | `infra/envs/dev` | `infra/envs/prod` |
| Server | `jarvis-dev` | `jarvis-prod` |
| Where | AWS Lightsail, N. Virginia (`us-east-1a`), Ubuntu 24.04 | Same |
| Size | 1 GB RAM, $7/month, billed hourly | 2 GB RAM, $12/month |
| Lifetime | Built to test, destroyed after | Always on |
| Snapshots | Off | Daily, last 7 kept |
| Tailscale tag | `tag:dev` | `tag:prod` |
| Address | `https://dev-jarvis.eliadablah.com` on my tailnet | `https://jarvis.eliadablah.com` on my tailnet |
| Who can change it | Any push to `dev` (once CI/CD exists) | Only a merge to `main`, after I approve it in GitHub |

For quick app work I can also run the containers on my own PC with Docker Compose before anything touches a server.

## How a change gets to prod

1. **Work on `dev`.** I commit early and often there, including work in progress.
2. **Test on dev.** I build `jarvis-dev`, check that the change works, then destroy it.
3. **Pull request.** I open a pull request from `dev` into `main` and review the diff.
4. **Merge and approve.** Merging to `main` is the only way prod changes, and prod changes wait for my approval.

Right now steps 2 and 4 run from my PC with Terraform. Next, GitHub Actions takes them over:

- Push to `dev` → check the code, build the Docker image, update dev.
- Merge to `main` → wait for my approval in the `production` environment → update prod.

## The domain

I own `eliadablah.com`. Jarvis gets subdomains, but **they are private on purpose**:

- The DNS records point at Tailscale addresses (`100.x.x.x`), not public IPs.
- Anyone can look up the name, but only devices signed in to my Tailscale network can actually connect.
- HTTPS certificates come from Tailscale or from a DNS challenge, so I never have to open port 80 or 443 to the internet.

This keeps the rule from my AWS plan: **nothing listening on the public internet.** Jarvis can run commands, so a public login page would be a big target.

If I later need Jarvis from a computer that isn't mine, I'll add Cloudflare Access in front instead of opening the server up.

## DNS records

Managed by the deploy pipeline in Route 53 (TTL 60 seconds), refreshed on every deploy because a rebuilt server gets a new Tailscale address.

| Name | Type | Points to |
|---|---|---|
| `jarvis` | A | `jarvis-prod`'s Tailscale IP |
| `dev-jarvis` | A | `jarvis-dev`'s Tailscale IP (only while dev exists) |

HTTPS certificates come from Let's Encrypt through a DNS challenge run by CI, are stored in a private S3 bucket, and are reused until 30 days before expiry. The servers never hold AWS credentials.
