# Jarvis

My personal AI assistant. I talk to it out loud, it remembers what I'm working on, and it can take real actions on my machine, but only after it asks me first.

I'm building Jarvis as a hands-on DevOps project: I put it together, locked it down, and I'm moving it from my PC to the cloud with Terraform, separate dev and prod environments, and a dev → prod release flow.

## What it does

- **Remembers me.** Jarvis reads and writes an Obsidian vault of plain-text notes, so it keeps context between sessions.
- **Talks.** I hold a key, speak, and it answers through my speakers.
- **Has a face.** A full-screen visualizer reacts while it listens, thinks, and speaks.
- **Takes action, with permission.** It can edit files and run commands, but it says out loud what it's about to do and waits for my "yes".

## How I set it up

| Layer | What runs it | My setup |
|---|---|---|
| Brain | Claude Code | Custom Jarvis identity and boot file |
| Memory | Obsidian vault | Raw (inbox) → Wiki (clean notes) → Outputs (finished reports) |
| Voice | Local speech-to-text and text-to-speech | Push-to-talk, British male voice, ask-before-acting |
| Face | Browser visualizer | Full-screen circuit-board scene |
| Servers | AWS Lightsail, built with Terraform | `jarvis-dev` for testing, `jarvis-prod` for daily use |

## How I ship changes

```text
dev branch  →  test on jarvis-dev  →  pull request  →  main branch  →  approve  →  jarvis-prod
```

Nothing reaches prod without passing through dev first. Details in [docs/environments.md](docs/environments.md).

## Security decisions

- **Ask-first permissions.** I turned off the "do anything without asking" mode. Jarvis has to ask out loud before any real action.
- **Nothing public.** On both servers, no TCP port is open to the internet: not SSH, not HTTP, not HTTPS. The only open port is Tailscale's encrypted UDP port, which answers only my own devices. Everything else goes through my private Tailscale network.
- **Least-privilege network rules.** The GitHub deploy robot can only reach the server over SSH, and the server can't reach my PC or phone at all.
- **No secrets in git.** Real settings and tokens stay on the machine. This repo only has `.example` files with placeholders.
- **Budget guardrail.** An AWS Budgets alert fires at $15/month.

## Roadmap

- [x] Run Jarvis locally (voice, face, memory)
- [x] Restructure the vault into Raw / Wiki / Outputs
- [x] Switch voice permissions to ask-first
- [x] AWS budget alert at $15/month
- [x] Terraform foundation: encrypted state bucket, GitHub deploy roles with no stored AWS keys
- [x] Private Tailscale network with tagged, least-privilege rules
- [x] Terraform for dev and prod servers
- [x] Build and test `jarvis-dev`: joins Tailscale on first boot, SSH only through Tailscale, Docker ready
- [ ] Build `jarvis-prod` from the same tested blueprint
- [x] Web app in a Docker container (TypeScript, tested, runs as a non-root user)
- [x] GitHub Actions: checks on every push, automatic deploys to dev
- [x] HTTPS on my own domain: `https://dev-jarvis.eliadablah.com`, reachable only on my private network, certificate issued by CI with no AWS credentials on the server
- [x] Text chat with Jarvis on the site, powered by Claude Code (talk only, no tools yet)
- [ ] Jarvis reads my Obsidian vault (private repo sync)
- [ ] Voice: mic button and spoken answers in the browser
- [ ] Approval-gated deploys to prod at `https://jarvis.eliadablah.com` (pipeline ready, waiting on `jarvis-prod`)

## Repo layout

```text
infra/       Terraform for AWS
  bootstrap/       state bucket + GitHub deploy roles (one-time)
  modules/server/  reusable Lightsail server that joins Tailscale on first boot
  envs/dev/        jarvis-dev, the temporary test server
  envs/prod/       jarvis-prod, the always-on server
app/         The Jarvis web app (TypeScript) and its Dockerfile
deploy/      How the app runs on a server, and the script CI uses to deploy it
.github/     GitHub Actions: CI checks and the dev/prod deploy pipeline
config/      Settings templates with placeholders (copy, rename, fill in)
docs/        Setup guide and the dev/prod environment plan
CHANGELOG.md What changed and when
```

## Setup

See [docs/setup.md](docs/setup.md).

## Credits

Jarvis runs on the open-source [fullstack-agent](https://github.com/jaredrhod/fullstack-agent) kit by [jaredrhod](https://github.com/jaredrhod). Its parts keep their own licenses (AGPL-3.0, plus CC BY-SA 4.0 for the vault templates) and are installed from their own repos, not copied here.
