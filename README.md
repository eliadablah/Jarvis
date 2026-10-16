# Jarvis

My personal AI assistant. I talk to it out loud, it remembers what I'm working on, and it can take real actions on my machine, but only after it asks me first.

I'm building Jarvis as a hands-on DevOps project: I put it together, locked it down, and I'm moving it from my PC to the cloud with Terraform, separate dev and prod environments, and a dev → prod release flow.

## What it does

- **Remembers me.** Jarvis reads an Obsidian vault of plain-text notes, so it keeps context between sessions. On the server it can read the vault but not change it.
- **Chats from anywhere I'm signed in.** A web chat on my private network streams Jarvis's answers as it writes them.
- **Talks.** I hold a key, speak, and it answers through my speakers.
- **Has a face.** A full-screen visualizer reacts while it listens, thinks, and speaks.
- **Takes action locally, with permission.** The PC assistant asks before edits or commands. Web chat stays read-only.

## How I set it up

| Layer | What runs it | My setup |
|---|---|---|
| Brain | Claude Code or Codex | Jarvis persona, selectable web engine, shared vault |
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
- [x] Text chat powered by Claude Code or Codex, with separate conversations and read-only vault context. See [Codex setup](docs/codex.md).
- [x] Jarvis reads my Obsidian vault: private repo, read-only deploy key, synced every 5 minutes, read-only tools
- [x] The local experience on the web: full-screen ai-visualizer face, hold-to-talk mic, and Kokoro `bm_lewis` voice in the browser, with the face moving to the real audio
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

Jarvis runs on the open-source [fullstack-agent](https://github.com/jaredrhod/fullstack-agent) kit by [jaredrhod](https://github.com/jaredrhod). Its parts keep their own licenses (AGPL-3.0, plus CC BY-SA 4.0 for the vault templates) and are installed from their own repos, not copied here. The web faces are [ai-visualizer](https://github.com/jaredrhod/ai-visualizer) (AGPL-3.0), fetched unchanged at build time. The browser voice is [Kokoro](https://github.com/hexgrad/kokoro) via kokoro-js (Apache-2.0).
