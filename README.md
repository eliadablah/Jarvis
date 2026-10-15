# Jarvis

My personal AI assistant. I talk to it out loud, it remembers what I'm working on, and it can take real actions on my machine, but only after it asks me first.

I'm building Jarvis as a hands-on DevOps project: I put it together, locked it down, and I'm moving it from my PC to the cloud with separate dev and prod environments.

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
| Hosting | My PC (dev), AWS Lightsail (prod) | See [docs/environments.md](docs/environments.md) |

## Security decisions

- **Ask-first permissions.** I turned off the "do anything without asking" mode. Jarvis has to ask out loud before any real action.
- **Nothing public.** In prod, the server has zero ports open to the internet, not even SSH. Only devices on my private Tailscale network can reach it.
- **No secrets in git.** Real settings and tokens stay on the machine. This repo only has `.example` files with placeholders.
- **Budget guardrail.** An AWS Budgets alert fires at $15/month.

## Roadmap

- [x] Run Jarvis locally (voice, face, memory)
- [x] Restructure the vault into Raw / Wiki / Outputs
- [x] Switch voice permissions to ask-first
- [ ] Lightsail server + Tailscale + firewall locked shut
- [ ] `jarvis.eliadablah.com` pointing at prod, reachable only on my private network
- [ ] Dev → prod deploys through git branches
- [ ] Vault sync through a private repo
- [ ] Phone dashboard with browser voice
- [ ] Snapshots, auto security updates, budget alerts

## Repo layout

```text
config/      Settings templates with placeholders (copy, rename, fill in)
docs/        Setup guide and the dev/prod environment plan
CHANGELOG.md What changed and when
```

## Setup

See [docs/setup.md](docs/setup.md).

## Credits

Jarvis runs on the open-source [fullstack-agent](https://github.com/jaredrhod/fullstack-agent) kit by [jaredrhod](https://github.com/jaredrhod). Its parts keep their own licenses (AGPL-3.0, plus CC BY-SA 4.0 for the vault templates) and are installed from their own repos, not copied here.
