# Environments: dev and prod

I run two copies of Jarvis so I can try changes without breaking the one I rely on.

| | Dev | Prod |
|---|---|---|
| Where | My Windows PC | AWS Lightsail (Linux, 2 GB RAM) |
| Address | `localhost` on the PC, `dev.jarvis.eliadablah.com` on my tailnet | `jarvis.eliadablah.com` on my tailnet |
| Git branch | `dev` | `main` |
| Purpose | Try new settings, prompts, and dashboard code | The Jarvis I actually use day to day |
| Permissions | Ask-first | Allowlist: read/write the vault and run git; everything else asks |

## How a change gets to prod

1. I make the change on the `dev` branch and test it on my PC.
2. When it works, I open a pull request from `dev` into `main` and review the diff.
3. I merge it, and the prod server pulls `main` and restarts Jarvis.

Later, step 3 becomes a GitHub Actions job that deploys over Tailscale, so prod only changes when `main` changes.

## The domain

I own `eliadablah.com`. Jarvis gets subdomains, but **they are private on purpose**:

- The DNS records point at Tailscale addresses (`100.x.x.x`), not public IPs.
- Anyone can look up the name, but only devices signed in to my Tailscale network can actually connect.
- HTTPS certificates come from Tailscale or from a DNS challenge, so I never have to open port 80 or 443 to the internet.

This keeps the rule from my AWS plan: **nothing listening on the public internet.** Jarvis can run commands, so a public login page would be a big target.

If I later need Jarvis from a computer that isn't mine, I'll add Cloudflare Access in front instead of opening the server up.

## DNS records (planned)

| Name | Type | Points to |
|---|---|---|
| `jarvis` | A | Prod server's Tailscale IP |
| `dev.jarvis` | A | My PC's Tailscale IP |
