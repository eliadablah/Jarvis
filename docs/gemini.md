# Gemini engine

Gemini is Jarvis's third chat engine, next to Claude Code and Codex. It talks
to Google's [Interactions API](https://ai.google.dev/gemini-api/docs) directly
with `fetch`, so the app still has no runtime dependencies.

## What it can and can't do

- Answers in the Jarvis persona. No tools: it can't read files, run commands,
  or change tasks.
- Never answers Gmail or Calendar questions; those stay with Codex.
- In **Auto**, it's the last fallback after Claude and Codex.
- Sees no vault notes or dashboard tasks unless `GEMINI_SHARE_VAULT=true`.
  On Google's free tier, prompts may be reviewed and used to train Google's
  models, so this stays `false` unless the project has billing turned on.
- Follow-ups work through `previous_interaction_id`. Google keeps each
  interaction for 1 day on the free tier (55 days paid); Jarvis only keeps the
  latest interaction ID in memory, so a server restart starts a fresh thread.

## Setup

1. Create an API key in [Google AI Studio](https://aistudio.google.com/api-keys).
2. Store it as a GitHub Actions secret (paste it at the hidden prompt):

   ```bash
   gh secret set GEMINI_API_KEY --repo eliadablah/Jarvis
   ```

3. Push to `dev`. The deploy writes the key into the server's deploy-user-only
   `~/jarvis/.env`; it never goes into the image or the repo.

Without the secret, the Gemini option shows as disabled.

## Settings

| Variable | Default | Purpose |
| --- | --- | --- |
| `GEMINI_API_KEY` | (none) | Turns Gemini on. |
| `GEMINI_MODEL` | `gemini-3.8-flash` | Model ID, e.g. `gemini-3.5-flash-lite` for cheaper answers. |
| `GEMINI_FALLBACK_MODEL` | `gemini-3.5-flash-lite` | Tried once when the main model answers 503 (overloaded). |
| `GEMINI_SHARE_VAULT` | `false` | Send vault excerpts and tasks with each question. |
| `GEMINI_ENABLED` | `true` | Set to `false` to switch Gemini off while keeping the key. |

Usage limits per project are on AI Studio's **Rate Limit** page; daily limits
reset at midnight Pacific.
