# Perplexity engine

Perplexity is Jarvis's fourth chat engine, next to Claude Code, Codex and
Gemini. It talks to Perplexity's [Agent API](https://docs.perplexity.ai)
(`POST /v1/agent`) directly with `fetch`, so the app still has no runtime
dependencies. Perplexity recommends the Agent API for new projects; the older
Sonar chat endpoint is being phased out.

## What it can and can't do

- Answers with live web search and shows the sources it used under the answer
  ("Sources: 1. title - link"). The numbered markers inside the text ("[1]",
  "[web:2]") are removed, so a real `[1]` in an answer is removed too.
- Answers in the Jarvis persona. No tools of its own: it can't read files, run
  commands, or change tasks. It is **not** a PC agent; for that, Jarvis hands
  work to Claude Code or Codex through Hands.
- Never answers Gmail or Calendar questions; those stay with Codex.
- **Auto** picks it only for live web questions ("latest news about ...",
  "search the web for ...", weather, scores, current prices). It is never a
  fallback when another engine is out of quota, because every request costs
  money. Pick it by hand in the model picker for anything else.
- Sees no vault notes or dashboard tasks unless `PERPLEXITY_SHARE_VAULT=true`.
- Follow-ups work through `previous_response_id`. Jarvis only keeps the latest
  response ID in memory, so a server restart starts a fresh thread. If
  Perplexity no longer knows a thread, the question is asked again as a new one.

## Cost

The API is billed separately from a Perplexity Pro subscription: you add API
credit in your Perplexity account and each request spends some of it. An empty
balance shows in Jarvis as "Perplexity reported a usage limit or an empty API
balance." Check current prices on Perplexity's API pricing page before turning
it on; I did not verify exact per-request costs.

## Setup

1. In your Perplexity account, open the API settings (API Group / API keys),
   add a little credit, and create a key.
2. Store it as a GitHub Actions secret. Paste it at the hidden prompt; never
   into chat or a file in the repo:

   ```bash
   gh secret set PERPLEXITY_API_KEY --repo eliadablah/Jarvis
   ```

3. Push to `dev`. The deploy writes the key into the server's deploy-user-only
   `~/jarvis/.env`; it never goes into the image or the repo.

Without the secret, the Perplexity option shows as disabled.

## Settings

| Variable | Default | Purpose |
| --- | --- | --- |
| `PERPLEXITY_API_KEY` | (none) | Turns Perplexity on. |
| `PERPLEXITY_EFFORT` | `fast` | The Agent API `effort` level (a preset model plus search settings; web search is on in all of them). `fast`: quick facts. `low`: everyday research. `medium`: multi-source questions. `high`: expert-level, exhaustive. `xhigh` and `ultra-preview` are for long agentic research and cost the most, so they are not worth it for chat. Older Perplexity prompts call this field `preset`; the current docs call it `effort`. |
| `PERPLEXITY_SHARE_VAULT` | `false` | Send vault excerpts and tasks with each question. |
| `PERPLEXITY_ENABLED` | `true` | Set to `false` to switch Perplexity off while keeping the key. |

## Not the same as Perplexity's desktop agent

Perplexity's own "Personal Computer" feature (Pro plan, Windows app) controls a
PC through its desktop app. It is a click-around app with no documented command
line, so Hands can't drive it the way it drives Claude Code and Codex. This
engine only chats and searches.
