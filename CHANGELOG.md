# Changelog

## 2026-10-17

### Fix - Translate approved Chrome uploads to file contents

- Added a private stdio controller for the installed Chrome bridge's path/content mismatch. It reads only connected resume/CV folders, enforces the 10 MB limit, and sends file contents through Chrome's batch transport while retaining site permission checks. Disabled tools are also rejected inside batches. No file contents enter model context or logs.
- Uses the private Python installed with Windows action tools. Browser navigation remains available without that runtime; upload compatibility requires it. Actual resume attachment succeeded in a scoped probe; no application submission is claimed.
- Clarified that background CAPTCHA elements alone are not interactive challenges. Actual challenges still pause for the user. Added controller and routing checks to CI.

### Fix - Give Codex direct Chrome tools for browser and job tasks

- Browser and job runs now connect Codex to the installed Chrome extension instead of Windows screen controls. Desktop runs retain Windows-MCP; workspace runs expose neither bridge. Advertised capabilities follow the configured executables.
- Required MCP startup, scoped tool lists, automatic approval review and platform sandbox controls remain enforced. Site permissions and file-sharing restrictions still require their normal grants. Connected-browser discovery passed; application navigation paused at an extension permission prompt. No new application submission is verified.
- The private bridge entrypoint was verified with Claude Code 2.1.301 and must be retested on CLI upgrades.

## 2026-10-16

### Fix - Review authorized Codex desktop actions

- Codex Computer now requests automatic approval review for native MCP actions. The previous never policy rejected switching to Chrome even after a successful desktop snapshot. Workspace-only Codex tasks retain their existing approval policy.
- Sandbox and managed permission requirements still apply; denied actions must stop without tool substitution. Regression checks cover the distinct computer and workspace approval modes. Actual application submission remains unverified.

### Fix - Wait for Codex Windows tools before starting a task

- Made the native MCP server required for Codex computer runs, so it waits for initialization and fails before model execution when the server is unavailable. A live probe discovered all 18 tools; a missing-server probe exited with an initialization error.
- Added explicit tool-discovery guidance for Codex's normalized namespace and reuse of suitable existing tailored PDFs. Managed permission profiles and denied-action handling remain intact.

### Fix - Fall back after report-only provider refusal

- StructuredOutput and ToolSearch no longer count as possibly completed PC actions. A provider that only discovers tools or reports unavailability can hand off to Codex; real and unrecognized tool calls still prevent automatic retry.
- Added regression coverage for the observed report-only refusal and the duplicate-action guard.


### Fix - Restart checks and desktop tool exposure

- Restart status uses bounded Node HTTPS and validates active-task data before stopping anything. Normal certificate and task recovery protections remain enforced.
- Replaced the empty Windows-MCP explicit filter with a verified exclusion filter exposing the intended 18 tools. Non-job reports explicitly reserve submission counts for job applications, and valid JSON result reports are validated alongside structured output.


### Feature - Requested browser actions and general Windows execution

- Added browser execution and computer capabilities. Requested browser edits, messages, form work and calendar updates no longer use a forced read-only prompt. Windows-MCP provides app, screen/input, file and command tools to local Claude and Codex adapters.
- Added shared provider cooldowns and capability-based desktop/browser fallback. Workspace Claude can execute requested checks. Existing platform sandbox profiles remain intact.
- Installed/configured a pinned private Windows runtime; activation requires restarting the idle worker once with pc-worker/enable-actions.ps1. Older workers cannot claim new action tasks. The dashboard reports action readiness separately from worker connectivity.
- Native MCP startup and tool inventory passed. Automated scope/dispatch tests passed; real desktop execution remains pending the worker restart.

### Fix - Job commands keep their scope after opening a browser

- "In my Chrome, open LinkedIn and apply to a job" uses the application worker scope, capped at one, instead of read-only browsing. Explicit smaller limits, zero, and no-submit instructions remain enforced.
- Misheard "apply to a joke" asks for clarification before anything queues. The reply panel shows the original typed or spoken request, and PC activity shows the user's wording instead of internal worker normalization.
- Verified 94 tests and protocol-2 compatibility without restarting the worker. No real applications were submitted in these checks.

### Fix - Natural PC actions and readable replies

- Ordinary requests such as "open my job tracker", "open this link" and "on my PC open ..." route to the authenticated PC worker before any chat model. The running protocol-2 worker needs no restart. Agent choice follows capability and observed availability.
- "Open it" uses one recent unambiguous reply link; missing or multiple destinations ask for a target. Removed guessed browser popups and refreshed capability guidance on every model turn, including resumed conversations.
- Long replies wrap and scroll inside the companion panel in A/B/C and mobile. The orb becomes compact while reading, and the model-tip card stays out of the reply area.

### Feature - Scoped PC tasks, protocol 2

- Standalone Codex runtime and trusted CA bundle avoid desktop-runtime and certificate conflicts. Permission refusals before any tool use can fall back to the next capable agent. Worker updates include an idle-only restart helper; managed permission profiles remain enforced.
- Natural voice prefixes and spoken application counts retain the requested cap. Timestamp digits cannot be mistaken for HTTP usage limits. Activity previews stay concise; full reports remain under Details.

- PC requests now parse into a fixed plan before anything is queued: job search / prepare / submit (with a submission cap) / tracker, browser read-and-navigate ("in my Chrome, find ..."), work inside a named approved workspace ("in my assistant workspace, ..."), or opening Calculator, Notepad or File Explorer. Questions, negations, and requests to bypass permissions never execute.
- The worker picks a capable local agent (Codex for workspace files, Claude with Chrome for jobs and browsing, Windows for app launch) and falls back only if one refuses before using any tools. Claude runs restricted (no Bash, skills or sub-agents) with a JSON report schema.
- Reports are structured and checked: submissions must match confirmation evidence with distinct URLs and stay within the cap; a clean process exit alone no longer counts as done.
- Leases, heartbeats, cancel (button or "cancel my PC task"), durable local reports, a single-instance lock, and a recovery hold after an interrupted run prevent duplicate actions. Old protocol-1 workers can no longer claim tasks.
- Dashboard shows PC activity. `install.ps1` keeps the existing token unless `-RotateToken` is passed. CI runs the new worker tests (`npm run test:pc`).

### Change - "Open ..." opens the link in a new tab

- Starting a message with "open", "pull up", "bring up" or "launch" (for example "open my job tracker") now opens the first link in Jarvis's reply in a new tab. The tab is reserved at the moment of the tap so pop-up blockers allow it; if the browser still blocks it, a notice points to the link in the reply.

### Change - PC worker takes any job-search errand

- Chat now hands the PC worker requests to submit or finish prepared applications ("submit the Dexian application", "submit all drafts", "submit 4 and 5") and to update the tracker, not only "apply to jobs".
- The worker reads the answer and story banks in `DAILY-JOB-RUN.md`, treats my Jarvis request as the approval that routine waits for, uses account-free company boards (Greenhouse, Lever, Ashby) as well as LinkedIn Easy Apply, skips on-site-only roles, and can read `Desktop\Resumes` (daily reports, tailored CVs).

### Change - Word-by-word spoken caption, voice at 1.75x

- With voice on, the dashboard no longer opens the reply panel over the views. The sentence being spoken appears in a centered caption and each word lights up as it's said (browser word-boundary events, with a timing estimate for voices that don't send them). A pulse shows while Jarvis is thinking; the caption fades out after the reply, and click or Escape closes it. With voice off, the reply panel works as before.
- Voice speed lowered from 2.5x to 1.75x (Kokoro, face-mode fallback voice, and dashboard).

### Feature - Jarvis applies to jobs through a PC worker

- "Apply to jobs" / "find me jobs" in chat now queues an errand instead of answering. A worker on my PC (`pc-worker/`) picks it up, runs Claude Code with Chrome control in my ai-job-search workspace, applies on LinkedIn Easy Apply in my signed-in Chrome (up to 10 per run), and reports back; the report is available to the chat.
- Worker endpoints need the `PC_WORKER_TOKEN` bearer token (GitHub secret → server `.env`); without it the feature stays off. See `docs/pc-worker.md`.
- Tests: queue, intent, and token checks.

### Change - Faster voice replies

- Spoken replies play at 2.5x: Kokoro's own `speed` setting (keeps the pitch natural), the face-mode browser fallback voice, and the dashboard voice.

### Fix - Job requests go to Claude

- Auto sent "apply to jobs for me" to Codex as everyday assistance. Job search, applications, resumes, cover letters, interviews, and LinkedIn questions now go to Claude.

## 2026-10-15

### Fix - Gemini retries on a backup model when Google is busy

- First live test on dev: `gemini-3.8-flash` answered 503 "high demand", so Jarvis showed "Gemini could not answer". Jarvis now retries once on `gemini-3.5-flash-lite` (`GEMINI_FALLBACK_MODEL`) when the main model returns 429, 500, or 503 (free-tier limits are per model). The server log records the model and status code, never the key or prompt.

### Feature - Gemini as a third chat engine

- Added Gemini (Google's Interactions API over plain `fetch`, model `gemini-3.8-flash`), selectable on the dashboard and in face mode. Auto uses it as the last fallback when Claude and Codex both refuse.
- Gemini has no tools and never handles Gmail or Calendar questions. It sees no vault notes or tasks unless `GEMINI_SHARE_VAULT=true` (off on dev), because free-tier prompts may be used to train Google's models.
- The API key goes from the `GEMINI_API_KEY` GitHub secret into the server's deploy-user-only `.env`; without the secret, Gemini stays switched off.
- Tests: 74 passing (stream parsing, error mapping, three-engine fallback, account-read guard).

### Fix - Clearer engine errors and auto-closing confirmations

- Found in live testing on dev: with Codex at its usage limit, an account question ("any meetings today?") answered "No chat engine is available… check server sign-in". It now says Gmail and Calendar go through Codex, that Codex reported a usage limit, about how many minutes until it's retried, and that Claude can't read the accounts yet. Other "nothing available" cases describe each engine's actual state instead of blaming sign-in.
- Short confirmations (view switched, task added, task completed) close the reply panel after 6 seconds, so it no longer covers views A and B. Real answers and errors stay open until closed.
- Tests: 68 passing (adds the cooldown message case).

### Dashboard views and connected assistant

- Added Evergreen A, orange Daylight B, and Mission Control C, with an automatic daily cycle and spoken view commands.
- Tasks persist privately on the server and feed Jarvis's briefing. Typed and recognized speech share one command handler.
- Auto routes between Claude and Codex using task suitability and observed provider limits; account reads use the connected Codex engine with explicit read-only Gmail/Calendar tools.
- Added app installation metadata. Bank balances and triggering the PC job runner remain unconnected and are labeled clearly. See [dashboard guide](docs/dashboard.md).


### Codex chat and shared memory

- The menu can switch between Claude and Codex, with separate conversation IDs. Codex receives bounded markdown excerpts from the same vault and has no command tools or connected apps.
- Project instructions connect local Codex work to the vault. Desktop chat transcripts are not automatically synchronized.
- The server image includes Codex and system CA certificates; authentication stays in its private persistent home volume.


### Fix - Voice never stalls on slow devices

- On dev, Kokoro took ~33 seconds to make 2.6 seconds of speech in the test browser, so Jarvis sat on "thinking" for minutes on long answers.
- Each sentence now goes to Kokoro only once it's loaded and as long as this device generates speech at least as fast as it plays (up to 1.2× real time). A sentence that isn't back in 6 seconds, or a device that's too slow, switches to the browser's own British voice, which speaks instantly while a speech-shaped waveform keeps the face moving.
- The worker reports how long each sentence took. The "too slow" verdict is remembered per device; switching the voice off and on in the menu gives Kokoro another try.

### App - Face and voice, like my local Jarvis

- The page is now the local Jarvis experience: the ai-visualizer circuit board fills the screen, with the chat, a hold-to-talk mic, and a menu floating on top. The menu switches between all four faces (Circuit Board, Radial, Face in the Code, Neural Core), turns the voice on or off, and starts a new chat.
- **Face:** the visualizer files are served unchanged from jaredrhod/ai-visualizer (AGPL-3.0), pinned to commit `6921e1d`, the same one as my local install. The Docker build fetches them from GitHub. The faces normally poll a local Python server for `/state` and `/config`; a small `face-bus.js`, injected before each face's `core.js`, answers those from the page's live state (idle, listening, thinking, speaking, plus the real audio waveform).
- **Ears:** hold the mic button (or the Home key, like local backtalk) to talk; the browser's own speech recognition turns it into a message.
- **Mouth:** Kokoro (kokoro-js 1.2.1) with the same `bm_lewis` voice as backtalk, running in a Web Worker in the browser. The answer is spoken sentence by sentence while it streams, and the audio's waveform drives the face. The model (~92 MB, q8) downloads once from Hugging Face and is cached; the engine files are self-hosted, with the build checking that their ONNX Runtime version matches the one bundled in Kokoro.
- **Security:** new file serving refuses paths outside its folder, dotfiles, and unknown file types. Separate content security policies for the app (only its own code, plus Hugging Face for model downloads, and `wasm-unsafe-eval` for the speech engine) and the faces (which need inline scripts).
- **Found and fixed while testing:** a worker message race (the worker listened only after importing the engine, so the first message was lost), a sentence splitter that stalled on numbers like "2.1", and an engine hang inside the worker when the page is cross-origin isolated (the page is now not isolated, so the engine runs single-threaded in the worker).
- Measured locally: the face follows state changes; the voice loads from cache in ~2 seconds and generates a 4.3-second sentence in ~15 seconds in the test browser (first load included), which is slower than real time. Real-world speed on my phone and PC still to be checked.
- Tests: 35 passing (adds sentence splitting, safe file paths, and face bus injection).

### Test - Vault on dev

- Deploy `2bcc660` succeeded. Asked "what are my open priorities?" in a new chat: Jarvis read `Active Priorities.md` from the synced vault and listed all seven items.
- Asked Jarvis to read `/proc/self/environ` (where the Claude token lives): it refused. That refusal came from the model; the `Read(//proc/**)` deny rule and `dontAsk` are the hard limits behind it.

### App - Jarvis reads my vault

- My Obsidian vault is now the private repo `eliadablah/jarvis-vault` (scanned for secrets first; workspace layout files ignored).
- New `vault-sync` container (alpine/git v2.52.0) clones the vault and refreshes it every 5 minutes into a shared volume. It uses a read-only deploy key that works only on that repo, with GitHub's published host keys pinned in `deploy/github_known_hosts`.
- Jarvis runs inside the vault with three read-only tools: Read, Glob, Grep. Denied on top of `dontAsk`: MCP tools, `/proc`, and Claude Code's own config. The vault is mounted read-only in the app container as a second lock.
- Persona now tells Jarvis to check the vault (`VAULT-INDEX.md`, `Active Priorities.md`, daily notes) before answering questions about me, to cite notes, and that it can't write yet.
- GitHub secret `VAULT_DEPLOY_KEY` holds the private key; the deploy writes it to a deploy-user-only file on the server. The local copy was deleted after upload.

### Test - Chat on dev

- Deploy `040101b` succeeded. On `https://dev-jarvis.eliadablah.com`, Jarvis answered in persona and a follow-up question correctly recalled the previous one (same session).
- Refused as designed: a request without the chat header (403), a request from another website's origin (403), and a session ID that looks like a flag (400).

### App - Text chat with Jarvis

- The home page is now a chat: type a message, Jarvis's answer streams in word by word, and follow-up questions continue the same conversation (session ID kept in the browser).
- `POST /api/chat` runs Claude Code headless (`claude -p --output-format stream-json --include-partial-messages`) with the Jarvis persona appended to its system prompt (`app/persona/jarvis.md`).
- Locked down for this first version: `--tools ""` (no built-in tools at all), `--disallowedTools "mcp__*"`, `--permission-mode dontAsk`, `--permission-prompts none`. The message goes in on stdin and the session ID must be a UUID, so neither can inject a command-line flag.
- Requests from other websites are refused: a custom header plus a JSON body forces a CORS preflight the server never grants, and a mismatched `Origin` is rejected. One answer runs at a time; answers stop after 5 minutes or when the browser disconnects.
- Image: Debian slim base (Claude Code ships a glibc binary), Claude Code pinned to the stable release 2.1.292, auto-update and telemetry off. Conversation history lives in a Docker volume.
- Auth: the one-year `claude setup-token` login is stored as GitHub secret `CLAUDE_CODE_OAUTH_TOKEN` and written by the deploy to a deploy-user-only `.env` on the server. It is never in the image or the repo.
- Tests: 24 passing (stream parsing, command-line safety, request checks, routing, config). Local end-to-end run reached Claude Code and displayed its error cleanly (this PC's own Claude Code login had expired); the full answer path gets verified on dev.

### Test - HTTPS on dev

- Deploy `5930e74` succeeded: DNS `dev-jarvis.eliadablah.com -> 100.65.48.56`, new Let's Encrypt certificate valid until 2027-01-13, health check over HTTPS returned the new version.
- `https://dev-jarvis.eliadablah.com` loads with a valid certificate on my tailnet; `http://jarvis-dev` returns 301 to it.
- One more fix along the way: lego's working folder is mounted at `/data`, because `/lego` in its image is the program itself.

### Fix - GitHub identity format and dev domain name

- The first HTTPS deploy failed at "Sign in to AWS": this repo uses GitHub's immutable OIDC subject format (`repo:eliadablah@232940632/Jarvis@1421100534:...`, owner and repo IDs included), but the roles trusted the old `repo:eliadablah/Jarvis:...` format. All three robot roles (plan, apply, dns) now use the immutable prefix, set once in `github_oidc_subject_prefix`.
- Renamed the dev address from `dev.jarvis.eliadablah.com` to `dev-jarvis.eliadablah.com`.
- Applied: 0 added, 4 changed, 0 destroyed.

### Deploy - HTTPS on my own domain

- Each deploy points `dev-jarvis.eliadablah.com` (or `jarvis.eliadablah.com` for prod) at the server's Tailscale address in Route 53. The address changes when dev is rebuilt, so every deploy refreshes it. TTL is 60 seconds.
- `deploy/dns-and-cert.sh`: CI gets a Let's Encrypt certificate with a DNS challenge (lego v4.35.2), stores it in the certificate bucket, and reuses it until it's within 30 days of expiring, so rebuilding dev doesn't hit Let's Encrypt's weekly limits.
- Caddy 2.11.7 runs in front of the app with that certificate; plain HTTP (including `http://jarvis-dev`) redirects to the HTTPS name. The app is no longer published directly.
- The deploy health check now goes through HTTPS on the server, proving Caddy, the certificate, and the app work together.
- The servers still hold no AWS credentials and still have no TCP ports open to the internet.

### Infra - DNS role and certificate bucket

- Bootstrap adds the `jarvis-github-dns` role: only the `dev` and `production` GitHub environments can assume it, and it can only change A and TXT records for the two Jarvis names (plus their `_acme-challenge` records). The other records in the zone are untouched.
- Adds the private, encrypted `jarvis-certs-<account>` bucket for certificates.
- Applied: 6 added, 0 changed, 0 destroyed. GitHub variables added: `AWS_DNS_ROLE_ARN`, `CERT_BUCKET`, `ROUTE53_ZONE_ID`.

### CI/CD - First deploy to dev

- First push with the pipeline deployed `9ac0466` to `jarvis-dev`: health check returned `{"status":"ok","env":"dev","version":"9ac0466"}`, and `http://jarvis-dev` shows the Jarvis page as Dev on my tailnet.
- CI failed only on ShellCheck findings in `deploy/deploy.sh`. Fixed: the remote compose step now uses a quoted heredoc with values passed as environment variables, the intentional runner-side expansions are marked with a reason, and the unused loop variable is gone.

### CI/CD - GitHub Actions pipeline

- `ci.yml`: on every push and pull request to `dev`/`main`, type-check, test, and build the app; `terraform fmt` and `validate` every stack without touching real state; lint the deploy script.
- `deploy.yml`: builds the image (tests run inside the Docker build), pushes it to GHCR tagged with the short commit SHA, then deploys. `dev` branch → `jarvis-dev` automatically; `main` → `jarvis-prod` after approval in the `production` environment.
- `deploy/deploy.sh`: joins nothing itself; runs after the runner joins Tailscale as `tag:ci`, SSHes in as `deploy`, ships the compose file, logs in to GHCR only for the pull, restarts the app, and checks `/healthz` until it reports the new version.
- GitHub setup: repo variable `TS_OAUTH_CLIENT_ID`; environments `dev` (no gate) and `production` (requires my approval).
- `.gitattributes` keeps Linux line endings on scripts and YAML.
- Checked locally: deploy script passes `bash -n`; workflow and compose files parse as YAML. First real run happens on the next push.

### Test - jarvis-dev end-to-end

- Third `jarvis-dev` build (single-line launch script) joined Tailscale about 2 minutes after creation as `tag:dev`, confirming the launch-script fix.
- Firewall: only UDP 41641 open. `tailscale ping` connected directly through that port (51 ms) instead of through a relay.
- Logged in with `ssh ubuntu@jarvis-dev` over Tailscale SSH, with no SSH port open to the internet.
- `/var/log/jarvis-boot.log` ends with `jarvis boot: finished`; Docker 29.1.3 installed; `deploy` user exists in the `docker` group with no sudo.
- Noted: the updates installed a new kernel, so the server reports "System restart required" after first boot.

### Fix - Single-line launch script

- The second `jarvis-dev` build also never joined Tailscale, even with Tailscale moved first. Both failed scripts started with a `#!/bin/bash` line that does nothing on its own, which fits a known Lightsail + Terraform problem where only the first line of a multi-line launch script runs.
- The boot script now travels base64-encoded inside a single sh-compatible line that unpacks it to a root-only file, runs it with bash, and deletes it.
- Tested in WSL Ubuntu: the launcher is one line, passes `sh -n`, unpacks to a script that passes `bash -n`, with the key, hostname, and tag in place.
- Confirmed by the next build: with the single-line launcher, the server joined Tailscale and the boot script ran to completion.

### Fix - Server first-boot script

- Found on the first `jarvis-dev` build: the server came up with the firewall correct but never joined Tailscale. With every TCP port closed, there was no way in to read the logs.
- The script now joins Tailscale first, so a later failure still leaves the server reachable.
- Waits up to 10 minutes for Ubuntu's own first-boot updates to release the package lock instead of failing (most likely cause of the original failure).
- Keeps existing config files on upgrade instead of stopping at a prompt, and avoids restart prompts.
- Logs everything to `/var/log/jarvis-boot.log`.

### Infra - Tailscale tag ownership

- Tailscale OAuth credentials require every key they create to carry all of the credential's tags, so a credential holding `tag:ci`, `tag:dev`, and `tag:prod` couldn't create a `tag:dev`-only key.
- The credential now holds only `tag:ci`, and the tailnet policy makes `tag:ci` an owner of `tag:dev` and `tag:prod`, so it can create keys for either server.
- Tradeoff: a `tag:ci` device could tag itself `tag:dev` or `tag:prod`. The only `tag:ci` devices are short-lived GitHub Actions runners.

### Docs - Dev to prod release flow

- Rewrote `docs/environments.md` around the dev → prod flow: `dev` branch and `jarvis-dev` for testing, `main` and `jarvis-prod` for daily use, prod changes only through an approved merge.
- README: added a "How I ship changes" section, updated the repo layout, and made the roadmap match what is actually built.

### Infra - Dev environment

- Added `infra/envs/dev`: `jarvis-dev` from the same server module as prod, `micro_3_0` ($7/month, billed hourly), `tag:dev`, no snapshots, built to test and destroyed after.
- Separate state key (`envs/dev/terraform.tfstate`) in the shared bucket.
- Validation: `terraform fmt -check` and `terraform validate` pass. Not applied yet.

### Infra - Prod server (Terraform)

- Added `infra/modules/server`: a Lightsail instance that joins my Tailscale network on first boot with a single-use, 1-hour, `tag:prod` key, then installs security auto-updates, Docker, and a limited `deploy` user.
- Firewall replaces Lightsail's defaults (SSH 22, HTTP 80) with a single rule: Tailscale's UDP 41641. Lightsail requires at least one rule, so "zero ports" isn't possible; no TCP port is open.
- Added `infra/envs/prod`: `jarvis-prod` in `us-east-1a`, `small_3_0` ($12/month), daily auto-snapshots, state in the bootstrap S3 bucket with S3 lock files.
- Tailscale credentials are read from environment variables only.
- Tailnet policy (managed in the Tailscale admin): added `tag:prod` and `tag:ci`, limited the CI robot to SSH on prod, and added policy tests that block saving if the robot could reach my PC or phone.
- Validation: `terraform fmt -check` and `terraform validate` pass. Not applied yet.

### Infra - Terraform bootstrap

- Added `infra/bootstrap`: private, encrypted, versioned S3 bucket for Terraform state, plus two GitHub Actions OIDC roles (read-only `plan`, and `apply` limited to the approval-gated `production` environment).
- Reuses the account's existing GitHub OIDC provider instead of creating a second one.
- Ignored Terraform state, plans, and real `.tfvars` files.
- Validation: `terraform fmt -check`, `terraform validate`, and `terraform plan` pass. Applied: 13 added, 0 changed, 0 destroyed.
- Verified after apply: bucket public access fully blocked, versioning on, apply role trusts only `repo:eliadablah/Jarvis:environment:production`, and existing GitHub deploy roles for other projects untouched.

### Repo - Initial public structure

- Added the README, setup guide, and dev/prod environment plan (`jarvis.eliadablah.com`, reachable only on my private network).
- Added `config/backtalk.json.example` with placeholder paths.
- Added `.gitignore` so the upstream kit folders, real settings, Jarvis's private boot file, and secrets stay out of git.

### Voice - Ask-first permissions

- Changed backtalk `permission_mode` from `bypassPermissions` to `ask`, so Jarvis asks out loud before any real action.
