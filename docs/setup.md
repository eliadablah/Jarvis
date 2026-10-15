# Setup

How I set up Jarvis on a Windows PC (my dev environment).

## 1. Install the kit

Jarvis runs on the open-source [fullstack-agent](https://github.com/jaredrhod/fullstack-agent) kit. I follow its Windows install steps, which put the parts in `~/my-agent`:

- `fullstack-agent`: the installer and launch scripts
- `ai-memory-vault`: the memory templates
- `backtalk`: voice
- `ai-visualizer`: the face
- `barehands`: optional webcam hand control

These folders are in `.gitignore`. Each one updates from its own repo.

## 2. Point it at my vault

My notes live in a separate Obsidian vault (`Jarvis Vault`), organized as:

```text
Raw/       Inbox. Anything goes in here first.
Wiki/      Cleaned-up notes Jarvis reads from.
Outputs/   Finished reports and write-ups.
```

## 3. Apply my settings

Copy each template from `config/` into the matching kit folder, drop the `.example` part of the name, and replace `YOUR_USER` with the Windows username:

| Template | Goes to |
|---|---|
| `config/backtalk.json.example` | `backtalk/backtalk.json` |

The important setting is `"permission_mode": "ask"`: Jarvis says out loud what it wants to do and waits for "yes" or "no". Saying "details" reads out the exact command.

## 4. Start it

Use the **Talk** shortcut the installer puts on the Desktop, or run `fullstack-agent\start.bat`.

## 5. Check it

Ask Jarvis to write a small file. It should ask first. Say "yes" and it goes ahead. Try again, say "no", and it stops.
