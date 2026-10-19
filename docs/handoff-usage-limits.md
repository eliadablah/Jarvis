# Handoff: live Claude and Codex usage limits (written at 96% of Claude's 5-hour limit)

Branch: `wip/usage-limits` (do not touch `main` or `dev`). Delete this file once the feature is merged.

## Goal
Show Claude's and Codex's 5-hour and weekly usage live on the Jarvis dashboard, with reset times, in the PC activity card and the right-hand side panel.

## What is already written (not yet verified)
- **Data sources (verified by hand on this PC):** Claude emits `{"type":"rate_limit_event","rate_limit_info":{"unifiedWindows":{"five_hour":{"utilization":0.96,"resetsAt":<epoch s>},"seven_day":{...}}}}` in every `claude -p --output-format stream-json` run. Codex writes `rate_limits.primary` (300 min) and `.secondary` (10080 min) with `used_percent` and `resets_at` into its `rollout-*.jsonl` session logs (folders `~/.jarvis/codex/sessions` and `~/.codex/sessions`).
- `pc-worker/limits.ts`: parsers (`claudeLimitsFromEvent`, `codexLimitsFromText`), `readCodexLimits`, `newerLimits`, and `probeClaudeLimits` (a one-word haiku request used only when idle for 30 minutes).
- `pc-worker/agents.ts` and `pc-worker/worker.ts`: `runAgent` takes an `onLimits` callback (Claude streams only); the worker keeps a `limits` object, refreshes it every claim loop and heartbeat, and sends it as `limits` in claim and heartbeat bodies.
- `app/src/pcTasks/protocol.ts`: `LimitWindow`, `AgentLimits`, `PcLimits`, and `sanitizeLimits` (strict validation). `store.ts`: `setPcLimits` (later reading wins per provider) and `PcTaskState.limits`. `api.ts`: reads `body.limits` on claim/heartbeat and returns `limits` from `GET /api/pc/tasks`.
- `app/public/limits.js` (bars and reset text; a window past its reset time shows as reset), wired into `app/public/pcActivity.js` (card plus a side-panel copy), styles in `app/public/dashboard-live.css`, `limits.js` added to `app/scripts/copy-assets.mjs`.
- Tests written: `pc-worker/limits.test.ts` and `app/test/limits.test.ts`.

## What is left
1. In `app`, run `npm run typecheck`, `npm run test:local` and `npm run test:pc`, and fix every failure. `npm run test:pc` must also run `../pc-worker/limits.test.ts`: add it to the `test:pc` script in `app/package.json` if it is missing.
2. Check `app/public/limits.js`, `app/public/pcActivity.js` and `app/scripts/copy-assets.mjs` agree (a browser file missing from the copy list breaks the dashboard).
3. Add a short "Usage limits" section to `docs/pc-worker.md` and a `CHANGELOG.md` entry under 2026-10-19.
4. Leave the changes in the working tree and report what passed and what is left.

## Rules
- Commit author is Elikem Adablah (`eliadablah@users.noreply.github.com`); no AI trailers or credits anywhere.
- Do not push, deploy, restart the worker, change Windows `.git` deny rules, or read any credential or token file.
- Keep protocol 2 compatible: old workers send no `limits`, and the server must ignore bad readings.
- The Windows launcher fails at random (an injected-code crash). Retry a failed command before assuming a real failure; `npm run test:local` avoids most of it.
