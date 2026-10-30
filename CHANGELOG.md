# Changelog

## 2026-10-30

### Fix - Show Perplexity's real error in chat

- On dev, Perplexity answered "needs its server sign-in renewed" even though the API console showed $10.00 of credit and the key as used a minute earlier, so the key was accepted and Perplexity refused something else; the generic message hid what.
- A Perplexity failure now ends with the HTTP status and Perplexity's own error code and message, for example "(HTTP 403: forbidden - ...)". Text is cut to 200 characters and anything shaped like a key (`pplx-...`) is replaced with "[key]". Other engines still show only the generic message, so CLI diagnostics stay hidden (`describePerplexityError`, `failureMessage` in `app/src/brain/`).
- Validation: type checks clean; 175 app tests pass (status and reason shown with the key removed, stream errors, Perplexity detail shown while Claude's diagnostics stay hidden). Not yet seen against the real error.

### Feature - Perplexity as a chat engine

- New engine next to Claude, Codex and Gemini (`app/src/brain/perplexity.ts`), using Perplexity's Agent API (`POST /v1/agent`, streaming) with `fetch` and no new dependency. Answers use live web search; the sources appear under the answer and the numbered citation markers are stripped from the text (even when split across chunks). Follow-ups continue through `previous_response_id`; a thread Perplexity no longer knows is asked again fresh.
- Picker: a Perplexity option in the model picker and the dashboard's Auto/Claude/Codex/Gemini/Perplexity list and the Models & permissions panel, disabled until `PERPLEXITY_API_KEY` is set. Auto picks it only for live web questions ("latest news about", "search the web", weather, scores, current prices) and never uses it as a fallback, because the API is billed per request.
- Privacy and secrets: vault notes and tasks are not sent unless `PERPLEXITY_SHARE_VAULT=true` (off in `deploy/compose.yaml`). The key comes from the `PERPLEXITY_API_KEY` GitHub secret, written by `deploy/deploy.sh` into the server's deploy-user-only `.env` like the Gemini key; it is never logged or echoed in errors. Setup and settings: `docs/perplexity.md`.
- Chose the Agent API because Perplexity's docs say Sonar chat completions support ended on 2026-09-27 and recommend the Agent API for new projects.
- Validation: type checks clean; new `app/test/perplexity.test.ts` (stream parsing, error mapping, citation filtering, sources, request body, config, picker, Auto routing, no-fallback rule, a full streamed answer and thread continuation, refused key and empty balance with a stubbed server); 174 app tests pass. Not run against the real Perplexity API: no key was used, so the exact stream and error format is as documented, not observed. API prices were not verified.
- Needs: create a Perplexity API key and set the secret (`gh secret set PERPLEXITY_API_KEY`), then push to dev.

### Feature - Send work to the engine that has run fewer tasks

- When Claude Code has run more tasks than Codex lately, new work now goes to Codex first (and the other way round). `providerLoad` in `app/src/pcTasks/store.ts` counts each engine's tasks from the last 24 hours (running ones included) and `claimNextPcTask` sends the counts with the claim. `chooseAgents` in `pc-worker/agents.ts` sorts the ready, capable engines by that count first, then by usage headroom, then by the old order. The live view says why ("Claude has run 5 tasks in the last day and Codex 2, so Codex takes this one.").
- Unchanged: only engines that can do the task and are not on cooldown or at the 90% reserve are considered, and fallback to the other engine on a failure before any action still works. Hands treats malformed counts as zero.
- Previously the choice only looked at usage-limit headroom, so one engine could take every task while the other sat idle.
- Validation: new `pc-worker/loadBalance.test.ts` (order by count, ties, unavailable engines, the 24 hour window, counts on a real claim, bad numbers); 78 worker tests and 162 app tests pass. Not yet seen on a real run. Restart idle Hands to load it.

### Feature - Quick lane: open links and apps while a long task runs

- Asking Jarvis to "open my job tracker Google Sheet at ..." while a job run was going did nothing: Hands takes one task at a time and the open request queued behind the run, and chat just reported the PC as blocked.
- New second lane in Hands (`quickPass` / `quickLoop` in `pc-worker/worker.ts`) for desktop tasks only. It claims with `lane: "quick"` (`claimNextPcTask` in `app/src/pcTasks/store.ts`): the quick lane runs while a long task runs, one quick task at a time, and a running quick task never blocks the main lane. Agent work is unchanged: still one at a time, so two agents never fight over Chrome or submit the same application twice.
- New plan `{ kind: "desktop", action: "open_url" }` (request text "Open this link on my PC: <url>"). "Open <https link>", "go to", "pull up", "show me my job tracker" and "open it" (after a link in chat) now use it instead of starting an agent in Chrome. The link opens in the default browser through `rundll32 url.dll,FileProtocolHandler` as a single argument. `safeLink` allows only https, a real host name, port 443, no username or password and at most 500 characters. Requests that do more than open a page ("open it and then update the first row") and plain http links still go to an agent.
- The server knows the tracker sheet (`JOB_TRACKER_SHEET_ID`), so "show me my job tracker" needs no link. Chat answers "Opening that link on your PC now." instead of "Queued".
- Needs the new `quick-lane-v1` executor feature, so an old Hands leaves a link task waiting instead of failing it. Restart idle Hands to load it.
- Changed behaviour: a bare "open https://..." used to start a Claude Chrome task; it now opens in the default browser without an agent. Two older test expectations were updated to say so.
- Validation: type checks clean; new `pc-worker/quickLane.test.ts` (link safety, routing, claiming while a job runs, one quick task at a time, quick lane never takes agent work, old Hands waiting, `quickPass` end to end with a stubbed server and runner); 73 worker tests and 162 app tests pass. The real Windows link launch was not run, so nothing was opened on the PC.

## 2026-10-29

### Fix - Stall watchdog for silent agents

- The morning job run sat at "Starting claude-chrome" for over an hour: Claude launched, connected every tool, then produced nothing, and Hands had no check except the 2 hour limit.
- `pc-worker/agents.ts`: an agent's real output (anything except `system` / `rate_limit_event` bookkeeping lines) resets a quiet timer. After 1 minute of quiet with no tool used, the live view says it hasn't answered. After 5 minutes with no tool used, the agent is stopped and restarted (two attempts) and then the task falls back to the next capable agent. After 20 minutes of quiet once a tool has run, the agent is stopped and the run is reported as needing review, never restarted, because it may have acted. A user cancel still wins.
- Validation: new `pc-worker/stall.test.ts` (thresholds, which events count as activity, retry and fallback rules). The watchdog's process handling was not exercised against a real silent agent.
- Needs: restart idle Hands (`pc-worker/restart.ps1`) to load it.

### Feature - Live view records the agent's Chrome window

- `pc-worker/liveView.ts`: the live video and screenshots now show only the topmost visible Google Chrome window whose title doesn't contain "Jarvis", instead of the whole monitor, so the dashboard no longer records itself and other apps and the taskbar stay out. Positions come from a read-only Windows lookup (window class, title, rectangle; trimmed to the desktop, DPI-aware). It re-checks every 10 seconds and restarts the recording when the window moves or resizes; the dashboard reconnects by itself. With no such window it records the main monitor as before. `{"capture": "screen"}` in `~/.jarvis/live-view.json` turns this off.
- Validation: tests for the window rectangle parsing, negative offsets on a second monitor, the restart rule, the saved setting, recording the window, and following a moved window. Ran the Windows lookup once on this PC: it found a Chrome window on a monitor with negative coordinates and ffmpeg accepted that area (output discarded, nothing viewed). Fixed while testing: the lookup now uses per-monitor DPI awareness, because the old setting returned rectangles ffmpeg rejected on a mixed-scaling multi-monitor desktop. Not yet watched end to end during a real agent run.

## 2026-10-28

### Feature - Live screen view: video, with screenshots as the other option

- The live island has Watch live. It plays a live video of the PC screen while Hands works, with a Video (recommended) / Screenshots / Hide switch, and falls back to screenshots by itself if video can't start or the browser can't play it.
- Hands (`pc-worker/liveView.ts`): while a task runs it asks the server every 2 seconds what the dashboard wants, and records only then. Video is ffmpeg on the main monitor (10 fps H.264, a keyframe each second, fragmented MP4, about 100 KB/s); screenshots are one JPEG every 2 seconds via ffmpeg, or PowerShell without it. Stops within seconds when the viewer leaves, the task ends, or the server is unreachable for 10 seconds. Worker change: one start/stop hook in `execute`.
- Server (`app/src/screen/`): relays the video as it arrives (an MP4 splitter keeps the start piece so a viewer can join mid-stream) and keeps the newest screenshot; both in memory only, dropped when the viewer leaves. Up to 3 viewers, slow viewers are dropped, uploads need the worker token, the viewer side needs the dashboard's request header. The server's 5-minute request limit is lifted for the long upload.
- Fixed while measuring: recording the whole 5266 x 2160 desktop only reached about 6 fps with chunks every 1.7 seconds; recording the main monitor gives a steady 10 fps with a chunk every second.
- Validation: type checks clean; server relay tests with a streamed upload, worker tests with fake processes (including the 10-second connection-loss stop), and the existing 55 worker tests pass. Played a live stream end to end in a browser (0 stalls over 10 seconds, about 1 second behind live), switched between video, screenshots and Hide, and checked the no-video-support fallback. Real recording was checked for format and speed only; the test used ffmpeg's test pattern so no real screen content was captured.
- Needs: restart idle Hands (`pc-worker/restart.ps1`) once so it loads the new code.

### Feature - Quiz popup with selectable answers

- Saying or typing "quiz me" (also "test me", "give me a quiz", "ask me a devops question", with an optional "on Kubernetes", "about k8s", "on Network+" and similar) now opens a quiz window instead of sending the phrase to chat, where it only produced a spoken caption. Five multiple-choice questions, a progress bar, instant green/red feedback with the explanation, keys A-D or 1-4 to answer and Enter to continue, and a score screen that reviews every missed question. An unknown subject gets a short reply listing the topics.
- `GET /api/learn/quiz?topic=` narrows a round to one topic (unknown topics are refused with the list). The Learn card's "Quiz me" button and its topic chips open the same popup; finishing a round updates the card's streak and counts.
- Fix: in views D and E the right and wrong answer colors were being overridden by the theme.
- Validation: type checks clean; 157 tests pass (phrase matching including things that must not open a quiz, topic-only rounds); played a full round by keyboard in a browser in both D and E.

### Feature - Daily DevOps teacher and tech news

- New DevOps teacher card and sidebar entry (Learn). One multiple-choice question a day with an explanation after you answer, a streak, topic progress, and a "Quiz me" five-question practice round. The bank (`learn/questions.ts`) has 57 questions across Networking (Network+), Linux, Git, Docker, Kubernetes, CI/CD, Terraform and AWS. The daily question rotates through the topics you've practised least, and a missed question returns after two days. History is saved on the server (`learn.json`) and days are counted in the morning-run time zone. The answer and explanation are never sent to the browser until you have answered; answering the daily twice keeps the first answer.
- New tech news card and sidebar entry. `news/feeds.ts` reads RSS and Atom from a fixed list (Hacker News, AWS News, Kubernetes, Docker, HashiCorp, The New Stack, GitHub, Ars Technica); `GET /api/news` caches for 30 minutes, skips feeds that are down, and falls back to the last good copy. The browser never supplies a feed address. Only http(s) links are shown and they open in a new tab.
- Fix: a retried task's title no longer stacks "Try again: Try again:".
- Validation: type checks clean; tests cover the feed reader (RSS, Atom, entities, unsafe links), merging and caching, the question bank (unique ids, four distinct choices, answer positions spread), question selection, the streak, answer handling and answer secrecy. Checked in a browser against the real feeds.

### Feature - Apple-style D/E, priority layout, live Hands feed and reminders

- Views D and E are restyled in an Apple-like language: system font stack with large titles, frosted-glass cards, pill buttons, a segmented view switch, and springy motion. Cards and rows lift and open up when hovered (hover-capable devices only; touch keeps everything visible). A, B and C are unchanged.
- D/E reorder the overview to the priorities: to-dos, queue (Hands activity), money and bills, jobs, reminders, then schedule. The Hands activity card sits beside the to-dos instead of spanning the page.
- New `liveIsland.js`: a pill at the top of the dashboard in every view. Collapsed it shows what Hands is doing with a progress ring and timer; hovering, focusing or tapping opens the step feed, a progress bar (a real ratio for job applications, a sliding bar otherwise), the queue, and Open/Stop controls. It waits open when a task needs an answer. `pcActivity.js` now announces each refresh as `jarvis:pc-state`; live updates already refresh within seconds.
- New reminders: tasks tagged `Reminder` with a `remindAt` time (`dashboard.ts`, validated and normalized to UTC). A Reminders card and sidebar entry sort them by time with plain labels (In 24 min, Tomorrow 9:00 AM, Overdue); reminders stay out of the to-do list and its counts. A notice shows once when one comes due while Jarvis is open. There is no background push notification yet.
- The Schedule card text now describes the five-view rotation.
- Validation: type checks clean; 140 app tests pass (new tests for reminders, progress description, and time labels); checked D and E in a browser, including hover, the live island with injected task data, and the add-reminder dialog.

### Feature - Aurora (D) and Ember (E) dashboard views

- New `dashboard-theme.css` restyles the dashboard (sidebar, cards, orb, command dock, modals) as view D, Aurora (violet and orange), and view E, Ember (charcoal and orange). `dashboard.js` sets `body[data-theme]` only for D and E, so A, B and C and their stylesheets are untouched. Spoken commands accept "view d", "aurora" and "ember". The file is in the `copy-assets.mjs` list.
- The automatic rotation now covers all five views, by the device's clock: B 6 AM, D 9 AM, A noon, E 3 PM, C 6 PM, D 10 PM. It is a placeholder schedule for comparing looks on dev; the table is at the top of `viewSchedule.js`.

### Feature - Every order goes to Claude Code or Codex

- New `pcTasks/errand.ts`: a clear order that matched no narrower errand (for example "fix the login bug in Jarvis", "write a cover letter") is now handed to Hands as a computer errand, which gives it to an available Claude Code or Codex run. Questions, statements, negations, permission-bypass phrasing, and Jarvis's own task list and reminders still stay in chat. The chat model's capability guidance says the same.
- Validation: type checks clean; 133 app tests pass, including new routing and view-rotation tests. The old test that kept "Write a cover letter for me" in chat now expects a handoff, which is the intended change.

### Config - PC worker renamed to Hands in the interface

- Dashboard labels, handoff replies, API errors and the chat persona now say Hands. Internal names (`pc-worker/` folder, `PC_WORKER_TOKEN`, scheduled task) are unchanged so the running worker and CI keep working.
## 2026-10-20

### Feature - One saved consent for Jarvis tools

- PC activity has Always allow Jarvis tools and a reversible Ask me again preference. Saved consent applies to the running personal task and future personal tasks across restarts, covering ordinary configured MCP tools and Claude file/web/skill tools. Genuine questions, connector auth/forms, unknown requests and OS permission/escalation requests remain interactive. Provider/OS denials, task caps and evidence checks remain in force; no launcher policy or sandbox flags change.
- Preference changes require the browser's HttpOnly session, same-origin JSON and a dedicated, state-bound HMAC capability. Worker tokens and ordinary action capabilities cannot change it. Applications of saved consent are labeled in the approval record. Already-running workers receive the existing approval format, requiring no restart.
- Tests cover persistence, revocation, pending prompts, immutable Deny, lease ownership, protected preference changes and required-input exclusions.

### Fix - Allow clicks on empty MCP approval forms

- Real Codex tool approvals use an empty object form. Jarvis previously required text even after Allow, then returned decline and misreported the tool as user-rejected. Empty forms now return an accepted empty object only after an actual Allow decision. The server also encodes that response for already-running workers; no restart or blanket permission grant is required for this fix.
- Approval cards show a plain action, relevant file/link, Allow this action and Don't allow. Permission-only requests have no answer box. Actual questions and connector forms show labeled fields in the dashboard theme; technical payloads are collapsed. Waiting tasks show they are paused, and historical Allow/rejection mismatches explain the error.
- Regression checks use the observed empty-schema MCP request through HTTP/session/lease approval and provider response handling, and preserve Deny, expiry, cancellation and required-question behavior.

### Feature - Personal Claude Code/Codex tools and dashboard approval relay

- Direct PC requests inherit the user's installed tools, plugins, skills and settings. The Claude Agent SDK and Codex app-server relay approval and input requests to PC activity, pause, then resume the same turn after an actual Allow once / Deny answer. Browser sessions and action tokens bind each response to the current worker/task lease. Expiry, cancellation and unknown requests fail closed. New personal tasks wait for full-tools-v2; scheduled and legacy profiles remain scoped.
- Job limits, verified receipts, Google synchronization, task ownership and duplicate checks remain in place. Server chat remains read-only. Tool availability does not grant authority for unrelated actions or bypass configured permissions.
- Firecrawl search/scrape were explicitly approved and are granted only to personal Claude child runs. A real connected Firecrawl public-documentation search succeeded. Personal job prompts no longer incorrectly forbid Firecrawl. No blanket approval/sandbox policy overrides or saved credential changes are added.
- Validation: 126 app and 48 worker tests, TypeScript checks and a local browser approval-form check cover inheritance, request authentication, expiry, cancellation and same-turn continuation. Live SDK/app-server approval verification remains blocked in this managed Windows session by two-way child-process pipe denial and Codex state-database access denial. The idle worker needs activation from normal PowerShell. No ACLs were changed.
- Automatic review rejected earlier permission overrides and an endpoint missing browser-session/CSRF/lease binding. The final design inherits provider policy and binds each dashboard answer to its immutable action and current lease.

## 2026-10-19

### Feature - Approved automatic Google logging and shared job history

- Following explicit approval, verified submission receipts sync automatically to the configured Google tracker using only Company, Role, Date Applied, Stage and Posting URL. Confirmation text and task IDs stay in Jarvis. Writes use separate OAuth tokens, literal cell values, URL deduplication, native formatting/validation and readback. Advanced/closed stages are preserved. Ambiguous delivery checks Google before retrying; durable receipts survive restarts with bounded backoff and visible errors.
- Claude and Codex job tasks gain a task/worker/lease-bound shared_job_state tool containing company, role, stage, posting URL and aggregate totals, with pagination. It excludes CVs, notes and other columns. Both providers log each confirmed submission through the same deterministic path.
- The existing service account was granted Editor on the existing tracker only and permissions were read back. New submission tasks wait for a receipt-capable worker. 123 app/40 worker tests and builds/typechecks pass; no fabricated tracker row or real job submission was created for tests. Local worker activation remains necessary; actual first live receipt delivery is not yet exercised.

### Fix - Google tracker as the live dashboard source of truth

- Google rows and totals are authoritative. Pending local confirmations appear separately and never inflate the Google counts. An outage shows saved/unknown state rather than false live totals.
- Read-only Google checks run every three seconds and push changed rows/counts to open dashboards. Concurrent requests share one read; failures back off for 30 seconds and recover automatically. The browser has a five-second fallback and refreshes on reconnect/focus. No AI tokens are consumed by sync checks.
- Validation: 117 app tests, TypeScript checks and all build stages passed. Coverage includes external changes, outage/recovery notifications, authoritative counts, concurrent readers and retry backoff. Google writes and new shared AI tracker access remain disabled after automatic review requested more explicit approval.

### Fix - Task-scoped application counts and pushed dashboard updates

- Fixed the retry confusing five October 18 applications with a new four-job request. Task claims now include only their original request/retry-family confirmations and budget. Unrelated history is a duplicate check, not task completion. Retry caps also include durable receipts from the same attempt.
- Added authenticated, task/lease-bound submission receipts, per-task caps, URL deduplication and durable PC-to-Jarvis delivery. Both provider job adapters expose the existing confirmation-log tool with task identity; a verified confirmation is published as soon as logged. Failed sync retries receipt delivery, never application submission. Final reports reconcile with receipts rather than hiding confirmations behind an incorrect zero report.
- Added same-origin server-sent dashboard updates, immediate job/PC refresh on change, a 30-second fallback poll, and local receipt overlays. Google-pending rows/counts appear separately from confirmed Google sync. Google read cache can refresh in the background so new local receipts need not wait on Google. Live clients reconnect normally across deployments.
- New job retries require task-sync-v1, so older workers wait for activation instead of repeating the history-count bug. Failure cards preserve meaningful explanations rather than always showing a generic zero-submission message.
- Validation: 116 app/39 worker tests and TypeScript/build checks. Tests cover unrelated history, retry receipts, task ownership/lease/cap enforcement, duplicate acknowledgements, offline receipt recovery, merged counts and a pushed live event without polling. No real job application or synthetic tracker row was submitted.
- Google writes and a proposed global tracker-read tool for AI providers were blocked by automatic approval review pending exact payload/permission approval. They are not enabled. The service account remains Viewer; no OAuth write scope or new provider-wide tracker tool was added. Dashboard shows Google sync pending until a row is independently read from the existing sheet.


### Fix - Least-used capable provider for PC tasks and real next-workflow time

- PC executor selection now compares fresh Claude/Codex allowance usage after capability/readiness checks. The provider with lower pressure across its active five-hour and weekly windows runs first, for scheduled and explicitly requested tasks. Missing/stale/invalid/expired readings are unknown, not zero; equal/unknown readings preserve existing ordering. The 90% reserve, cooldown and side-effect guards remain.
- Removed Claude-only workflow wording. The Next workflow card uses the live schedule API rather than a hard-coded 06:00 label. Added a live device-local date/year and clock, explicit 12-hour formatting (1 PM / 3:59 PM) for schedules and reset times, automatic midnight/focus updates, and calendar-day tomorrow handling. Job schedule instants display in the viewing device timezone; execution keeps its configured schedule timezone.
- Validation: 112 app tests and 38 worker tests, TypeScript and app build. Tests cover both providers winning, weekly bottlenecks, unavailable tools, 90% cutoff, missing/stale/expired readings and ties. Local worker activation is still required for the changed executor code; live UI deployment is tracked in the vault.


### Fix - Codex job files, visible failures and explicit retries

- Fixed the observed four-job run failure: Codex's job adapter had Chrome but no structured local file reader. Added required jarvis-job-files tools for approved job text/skill/history files, resume directory listing and actual PDF text extraction. Confirmed submission logging is URL-idempotent, confined to the existing log, and exposed only for submission tasks. No arbitrary shell, file write or path is exposed.
- Job PDF runtime is private and pinned to pdf-parse 2.4.5. Job file tools use normal MCP approval review and realpath boundaries; they reject traversal and symlink escapes. Other adapters retain existing tools.
- PC cards now show Why it stopped and the specific missing requirement without opening Details. Failure notifications include that reason. Try again creates a separate, idempotent user-requested run; partial job runs request only the remaining count and preserve original constraints. Completed, active and uncertain-connection tasks do not offer blind retries.
- Transient no-action startup/connection failures get at most three attempts with delay. Actual access/approval denial, authentication/quota failures and possibly performed actions are not blindly repeated. Existing capable-provider fallback and workspace quota checkpointing remain.
- Validation: 110 app tests, 36 worker tests, app/worker TypeScript and app build pass. A live Codex job diagnostic successfully read the real application log and actual 3-page master resume PDF without modifying files or submitting applications.
- Local activation attempt stopped at Windows Win32 process-inspection Access denied. Running worker was not replaced. pc-worker/activate-job-files.ps1 is ready for normal PowerShell activation. The failed four-job task was not automatically replayed.


### Feature - Ruflo project coordination for the local worker

- Installed and pinned Ruflo 3.57.1 in the private local runtime. Workspace Claude and Codex adapters receive nine Ruflo task/memory tools through a server-enforced allowlist. Browser/job/desktop adapters keep their existing tools. Ruflo records coordinate work; the existing scoped agent executes it. Autonomous swarms and API-billed agent execution are not enabled.
- Explicit “Use Ruflo in my jarvis project to review the router” commands canonicalize into the independently validated workspace protocol. Project context persists in Ruflo’s local project store. No vault copy or credentials are imported.
- Added a version check, argument-size bounds, rejection of unlisted tools and database path overrides, separate private runtime metadata and a checked activation helper. Codex workspace MCP calls use normal automatic approval review while retaining workspace-write sandboxing.
- Validation: 107 app tests, 33 worker tests, app and worker TypeScript checks and app build pass. Real Ruflo task creation and memory write/read/search pass, including retrieval from a fresh process. A live Codex worker run successfully called the Ruflo memory and task-list tools and reported the observed value/count.
- Local activation remains blocked: Windows denied the protected pc-worker.json alias update and Win32 process inspection needed for safe idle-worker restart. Runtime metadata was saved; no process was stopped or replaced. Use pc-worker/activate-ruflo.ps1 from normal Windows PowerShell. Real quota-triggered cross-provider continuation remains unverified; controlled-provider preservation tests pass.


### Fix - Direct continuation requests, quota-aware workspace handoff and in-site drafts

- Explicit project continuation and LinkedIn drafting commands now canonicalize directly into independently validated PC tasks, avoiding a second model-generated Run offer. Suggested actions inferred from statements still require a tap. Long valid offers (up to 1800 characters) no longer disappear at the old 400-character cutoff.
- Fresh usage readings at or above 90% exclude all adapters for that provider until the relevant window resets; stale and expired readings do not strand a provider. Existing capability, cooldown and sandbox checks remain enforced.
- A workspace agent that exits at quota after tool use saves a durable checkpoint before another capable provider continues. The next provider must inspect current files/diffs, preserve completed changes and finish only remaining work. Browser actions, submissions, authentication failures and unknown interrupted side effects are not replayed automatically.
- Drafting now reads full threads and stages replies in the site's composer, unsent, with report evidence. Explicit report-only/no-typing instructions and existing drafts are preserved. Non-editable sponsored messages must be reported as a limitation.
- Validation: 106 app tests and 31 worker tests pass with local no-subprocess test isolation; app typecheck/build and PC TypeScript checks pass. A controlled execution test simulates Claude's quota exit after a file edit, verifies the saved checkpoint reaches Codex, and checks the existing file is preserved. This is a simulated-provider test, not a live model handoff.
- Activation is blocked: Windows denied writing the local worker settings and the process query required by the safe idle-worker restart. Settings were not changed and the worker was not restarted. The server-side routing changes are local only; no commit, push or deployment was made.


### Feature - Live Claude and Codex usage limits, and search CLIs for job runs

- **Usage limits on the dashboard:** the PC worker reads Claude's 5-hour and weekly usage from the `rate_limit_event` in every Claude run (plus a one-word probe when idle for 30 minutes) and Codex's from its session logs, and sends them with each claim and heartbeat. The server validates and stores the later reading per provider, and the PC activity card and side panel show bars with reset times, with an honest "as of" age when the reading is old. Old workers that send no limits keep working.
- **Job runs can search:** job runs may run the installed search CLIs (`freehire-search`, `jobbank-search`, `linkedin-search`, `search` command only) through narrow shell patterns; any other shell command stays denied. The prompt tells the agent to use them alongside web search, since the 20-application run on 2026-10-19 found nothing without them.
- Tests: 104 app tests and 28 worker tests passing, and the type check is clean.

### Feature - Scheduled morning job run, jobs keep going past blocked ones, drafts saved

- **Scheduled task inside Jarvis:** every morning at 7:00 AM Dallas time the server queues "Apply to 10 job applications" for the PC worker (`MORNING_RUN_TIME`, `MORNING_RUN_COUNT`, `MORNING_RUN_TZ`). Once per day, only within three hours of the scheduled time, a run left waiting 12 hours is cancelled, and it can be paused from the "On your radar" card, which now shows the next run and the last result (`GET /api/schedules`).
- **Keep going:** a job that needs an answer Jarvis can't give truthfully (or a login, CAPTCHA, account or attestation) is skipped and listed under "Needs you", and the run moves on to the next suitable job. Jobs are searched across LinkedIn, Greenhouse, Lever, Ashby, other boards and career pages, not only LinkedIn.
- **No silent cap:** the worker used to cut any request to the local `maxApplications` (10). It now aims for the number requested (up to 25); the daily 10 belongs to the schedule.
- **Drafts reach you:** when asked to draft messages or replies, the agent puts each draft's full text in the report (Details), because its chat reply never reaches Jarvis. Earlier LinkedIn drafts were written but lost this way.
- Tests: 101 app tests and 25 worker tests passing (schedule time math including the November daylight-saving change, once-a-day queuing, pause, stale cancel, new prompts).

### Feature - Live "PC is working" view, and retry on Windows startup crashes

- The PC activity card now shows a running task as working: a pulsing indicator, the current step in plain words, a running timer, "last signal Ns ago", and the last few steps. It polls every 3 seconds while a task runs and turns amber if the PC is silent for a minute.
- The worker describes each agent tool event as a short sentence (`pc-worker/steps.ts`), never including typed text, commands, file contents or full URLs, and reports every new step at once (at most every 2 seconds). The server keeps the last 12 distinct steps per task.
- Root-cause work on the random launch failures found code injected into new processes crashing some of them at startup (a launch with no console window failed 4-6 of 40 times in a test; one with a console 0 of 40). Now an agent that dies to a Windows crash code before it ran any tool or produced a result is started again, up to three attempts; anything after a tool has run is never retried. Added `npm run test:local` (no subprocess per test file) as a development workaround.
- Tests: 96 app tests and 24 worker tests passing (new: step descriptions without private content, startup-crash detection, the server's step feed).

## 2026-10-17

### Feature - Everyday command phrasing, and tap-to-run offers for things chat can't do

- Jarvis now recognizes how people really give orders: "go ahead and ...", "feel free to ...", "make sure you ...", "let's ...", "okay Jarvis, ...", "can/could/would you (please) ...", "I need/want/'d like you to ...", "you should ...", with trailing "for me / please / thanks / right now" ignored. Statements ("I'm getting paid on Friday", "I need to apply to more jobs"), questions, negations and hypotheticals ("would you open Notepad if I asked?") still never run. The cleanup is in `app/src/pcTasks/phrasing.ts`; the strict PC-task grammar after it is unchanged, so politeness cannot widen what executes.
- When a message needs something chat can't do (a payday for the calendar, a file to organize), the persona makes the model end with a `PC_TASK` line. The dashboard hides it and shows a card with the exact task and a Run on my PC button (`app/public/pcOffer.js`). Nothing runs until the tap, which sends the normal validated "In my Chrome / On my PC, execute this task: ..." command.
- The offer rule is also repeated in the per-turn guidance sent to all three engines. On first live test the persona alone was ignored in a resumed conversation where earlier replies had said "I can't"; a fresh conversation followed it correctly.
- Tests: 96 app tests and 20 worker tests passing (new phrase table, offer parsing, a check that a model-written offer cannot become a job submission, and that every engine gets the offer format each turn).

### Fix - Tracker dates on the Job search card

- First live view showed each application's date as "2026/10" (the year was read as the month). It now shows month/day (for example 10/17), with a test covering it. Tests: 87 passing.

### Feature - Job search section connected to the Google tracker sheet

- The dashboard's Job search section now shows my real pipeline (applied, need me, responses, last 7 days) and a list of recent applications with stage, pay and posting links, read live from the Google Sheets tracker through a new `GET /api/jobs`. It refreshes every two minutes and when the tab regains focus.
- The server reads the sheet as a read-only Google service account (Viewer on that one sheet, `spreadsheets.readonly`), signing the JWT with `node:crypto` and calling the Sheets REST API with `fetch`: no new dependencies. Results are cached for a minute, with a saved copy served for up to ten minutes if Google is unreachable. `CV Used` and `Notes` never reach the browser.
- The key travels GitHub secret `GOOGLE_SERVICE_ACCOUNT_B64` → server `.env`; without it the section keeps showing "Tracker not connected". Setup in `docs/job-tracker.md`.
- Tests: 86 passing (adds row parsing, pipeline summary, JWT signing, and a full sign-in/cache/stale-fallback cycle against a fake Google).

### Feature - Jarvis for Windows desktop app

- Added `desktop/`: an Electron app (per-user NSIS installer, `Jarvis-Setup-0.1.0.exe`) that loads the same private dev dashboard in its own window with a tray, Start menu and desktop shortcuts. It keeps the existing PC worker separate and never rotates its credentials.
- Security: sandboxed, context-isolated renderer with no Node integration, no general IPC bridge or remote debugging; outside HTTPS links open in the system browser after confirmation. Hold-to-talk uses the local Windows speech recognizer through a narrow bridge (stops on release, focus loss, or after 60 seconds).
- Build output and `node_modules` stay out of the repo. Unsigned local build; 6 desktop tests pass (`npm test` in `desktop/`).

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
