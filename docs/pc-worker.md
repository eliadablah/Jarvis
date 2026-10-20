# PC tasks and local agents

Jarvis sends explicit PC requests to an authenticated Windows worker. The PC must be awake and signed in. The web server never receives desktop or shell tools.

## Requests

| Example | What can execute |
|---|---|
| Find support jobs but do not apply | Search only; no submissions |
| Prepare job applications for Acme | Local drafts; no submissions |
| Apply to three support jobs | Up to three submissions, within the local configured cap |
| In my Chrome, open LinkedIn and apply to a job | Job application scope, at most one submission |
| Apply to a joke | Clarify the speech transcription; do not queue |
| Submit my prepared job applications for Acme | Only the named applications |
| Update my job tracker | Local tracker changes |
| Open my job tracker / open https://example.com | Read and navigate through the Chrome worker |
| Open it | Open the one recent reply link; ask for a target if ambiguous |
| In my Chrome, find the AWS documentation | Observe and navigate as requested |
| In my Chrome, edit my Google Sheet | Browser action mode; perform requested edits |
| Send an email to a named recipient | Browser action mode; resolve missing details before sending |
| On my PC, organize my Downloads folder | Windows desktop/file task |
| Open Excel / open Spotify | General desktop agent |
| In my assistant workspace, create a budget template | Files in that approved workspace |
| In my jarvis project, review the task router | The configured Jarvis project |
| Open Calculator / Notepad / File Explorer | Fixed Windows launcher, no model cost |
| Show PC activity | Open the activity panel |
| Cancel my PC task | Cancel the single active/queued task; use its button when several exist |

Vague requests to submit drafts ask which drafts. Discussion, status questions and negations do not execute. The Windows-MCP adapter provides general app/window control, UI inspection, mouse/keyboard input, files and PowerShell with normal Windows user permissions. The worker reports the concrete missing input or Windows restriction when a step cannot execute.

Natural browser requests are normalized on the server to the existing protocol-2 command grammar. Already-running workers validate the same plan without a restart. The selected chat engine does not control dispatch or grant extra permissions. Browser-prefixed application commands retain job scope; singular jobs are capped at one, and smaller explicit limits are preserved. The canonical request is kept for worker validation while the original request is shown in PC activity and the reply transcript. Unsupported actions explain the missing capability; they never claim a queue or successful action. A single reply-link reference lasts at most thirty minutes in bounded private server memory and is lost on a server restart.

## Agent choice

- Claude and Codex are both eligible for supported tasks. Choose capable, ready adapters first, then the provider with the lowest fresh allowance usage. Compare the highest active five-hour/weekly percentage so the tightest limit is protected. Readings older than 35 minutes, invalid timestamps and expired windows are unknown, never zero. Known fresh readings rank ahead of unknown; ties retain existing adapter order. The 90% pause, cooldown, tool and no-duplicate-action checks still apply. Codex workspaces keep workspace-write sandboxing and scoped MCP approval review.
- Claude provides workspace file/command fallback with explicitly allowed Bash, while unrelated MCP servers, nested agents and skills remain disabled for that adapter.
- Claude with Chrome handles browser actions and job tasks. Browser observation and browser execution are separate capabilities; execution can fill forms, edit Sheets, upload requested files, send requested messages and change requested calendar entries. Its login and Chrome extension must be connected. Search, prepare and submit are separate task scopes. Profile and answer-bank files are preloaded with content hashes.
- Claude Computer and Codex Computer use the pinned Windows-MCP stdio adapter for general desktop tasks. Codex browser/job fallback uses direct Chrome extension tools instead of desktop screen controls. Its browser capability requires both the Codex and Claude executables; desktop capability requires Codex and Windows-MCP. Registry tooling is not exposed. Platform sandbox profiles are preserved.
- Windows directly launches the three supported apps without model cost.
- Numeric remaining tokens are unknown. Observed usage limits pause an agent for fifteen minutes; startup/auth failures pause it for one minute. Provider cooldowns are shared between that provider's adapters, and the executor rechecks availability before each fallback. Fallback happens only before any tools run. Nothing is retried automatically after a possible side effect.

## Results and recovery

The activity panel shows queued, running, stopping, completed, partly completed, needs-you and connection-lost states. Reports include agent-provided evidence and questions. A successful process exit does not mean the requested work succeeded. Application counts must match distinct confirmation URLs and the authorized cap. Zero confirmed submissions cannot be completed.

Workers heartbeat while running. Each task has an owner and secret claim lease; only that owner can report. Results are saved locally before delivery and retry idempotently after a connection failure. The worker never automatically repeats an interrupted action. Cancel asks the PC to stop its process tree; actions already performed remain.

A loopback port lock allows one protocol-2 worker per PC. Protocol-1 workers cannot claim new tasks. Old unscoped tasks need a new explicit request. An interrupted run with uncertain child processes puts the worker into a recovery hold. Review the application/files and stop any leftover agents before clearing recoveryHold in the local state file and restarting. Never simply requeue a task whose real outcome is unknown.

## Setup

Run from the repository:

    powershell -ExecutionPolicy Bypass -File pc-worker\install.ps1

Settings are private in %USERPROFILE%\.jarvis\pc-worker.json. Native adapter metadata is separate in %USERPROFILE%\.jarvis\desktop-runtime.json; the worker loads it without changing the protected token file. Existing tokens and workspace aliases are preserved; only initial installation or explicit -RotateToken changes the token and requires redeploying the server. Approved workspace aliases map to absolute local paths. The assistant workspace defaults to %USERPROFILE%\.jarvis\workspace.

The installer sets up a pinned standalone official Codex CLI and a trusted CA bundle. Restart an idle worker after an update from a normal PowerShell window:

    powershell -ExecutionPolicy Bypass -File pc-worker/restart.ps1

A worker started inside another coding agent can inherit that agent’s read-only permission profile. Restarting from normal PowerShell or the registered logon task starts the worker with its configured workspace permissions. Never remove a managed permission profile inside a restricted session.

Use a standalone official Codex CLI for unattended work rather than the desktop app bundled alpha binary. Keep its auth/runtime cache separate in %USERPROFILE%\.jarvis\codex; authenticate that cache with the official Codex login flow. Credentials, settings, reports and caches never belong in the repository.

The worker uses private temporary files for agent stdin/stdout to avoid named-pipe EPERM failures seen on Windows. Temporary prompt/output files are removed after a confirmed exit. Its state/outbox and log stay in %USERPROFILE%\.jarvis.

## Activating action tools

The existing process caches its tools. After installing this update, run once from normal Windows PowerShell:

    powershell -ExecutionPolicy Bypass -File pc-worker/enable-actions.ps1

The helper installs pinned windows-mcp 0.8.8 with a private Python 3.14 runtime if needed, then restarts only an idle worker. PC agents should show six adapters, browser actions ready, and Windows ready. New browser.execute/computer tasks cannot be claimed by older workers; they wait for the updated worker instead of falling back to old read-only instructions. Existing completed/uncertain tasks are never replayed.

Source and license: [Windows-MCP](https://github.com/CursorTouch/Windows-MCP), MIT. Runtime files stay outside the public repository.

## Checks

From app/: npm run typecheck, npm test, npm run test:pc, npm run build. CI runs both server and worker checks. The Linux image contains server code only; the worker runs on Windows.

No automatic job submissions, real emails, purchases or account changes are part of the integration smoke tests.

Restart checks use bounded Node HTTPS with certificate validation. Failed preflight leaves the existing worker alone. Check Tailscale if the private dev status cannot be reached. Windows-MCP 0.8.8 requires the verified exclusion filter: --exclude-tools Registry,DisplayInventory,Scrape exposes the intended 18 tools; its explicit --tools filter exposed zero with the installed FastMCP registry.

The restart helper saves timestamped startup output/error logs in .jarvis. A Windows Node 0xc0000005 startup crash gets at most three attempts, with local state and server activity checked again before each. Any unfinished task, pending report, recovery hold or non-native error stops retries. Persistent Windows crashes still need diagnosis; the helper does not disable Windows protections.

Provider fallback ignores only report construction (StructuredOutput) and tool discovery (ToolSearch) when checking for possible actions. Every other tool, including unknown tools, conservatively blocks retry after a refusal. A live controlled refusal reproduced this distinction; an intentional diagnostic refusal is not an actual provider outage.

Codex desktop runs mark jarvis-windows required; browser/job runs instead require jarvis-chrome. Optional MCP startup can finish after the initial tool catalog is built. Required startup waits for the selected server and rejects initialization failure. Discover tools under mcp__jarvis_windows__ or mcp__jarvis_chrome__. Effective shell permissions can remain read-only; never reroute a denied operation through another tool to bypass that policy. Existing suitable tailored resumes may be reused after inspection.

The direct Chrome bridge uses the internal --claude-in-chrome-mcp entrypoint, locally verified with Claude Code 2.1.301. This is not a documented compatibility guarantee; retest discovery, navigation and uploads after CLI upgrades. It exposes only selected Chrome tools, with no Windows or general Claude command tools. Get tabs_context_mcp first and use the task's own tab/group. Extension site permission prompts must be approved by the user. Direct navigation and application inspection were verified after approval. Actual application submission remains unverified.

Chrome uploads currently have an upstream path/content mismatch. When the private Python from Windows action setup is present, the worker uses chrome_bridge.py as its stdio controller. A custom private chromeMcpPython setting can select another installed Python 3.9+ runtime. The controller converts the normal file_upload paths into file contents and forwards one file_upload action through browser_batch, whose per-action Chrome permission checks still run. It never retries an action automatically. Only Desktop/Resumes and the job workspace's documents/cv folder are connected; resolved paths outside those folders, symlink escapes, injected file-content parameters, disabled/nested tools and combined uploads of 10 MB or more are rejected. File contents are not returned to the model or logged. Missing folders grant no access. Without the Python runtime, direct browser navigation remains available but the upstream upload incompatibility can still block applications. Run pc-worker/enable-actions.ps1 to install the private runtime, then restart the idle worker to activate source changes. A real scoped resume attachment probe succeeded; fields and Submit were untouched.

Job tasks pause for visible interactive CAPTCHA challenges, not merely a hidden reCAPTCHA integration or background badge. Never solve or bypass a challenge. A live no-action false alarm was independently checked against the actual Chrome page before continuing.

Codex Computer uses approval_policy=on-request and approvals_reviewer=auto_review so authorized native MCP actions reach the supported approval reviewer. The previous never policy rejected even switching to Chrome. This does not change managed profiles, writable roots, or denied-action handling. Workspace-only Codex keeps its existing never policy. Automatic review can still deny an action; report the reason and pause instead of changing tools to bypass it.

## Commands, requests and statements

Jarvis treats a message as an order only when it is one; the cues follow how people actually phrase requests (speech-act research on direct and conventionally indirect requests).

| Counts as an order | Examples |
|---|---|
| Direct commands, softened or not | "pull up my tracker", "please open Notepad", "just search for DevOps jobs" |
| Go-ahead and courtesy lead-ins | "go ahead and ...", "feel free to ...", "make sure you ...", "let's ...", "okay Jarvis, ..." |
| Requests phrased as questions or wishes | "can/could/would you (please) ...", "I need/want/'d like you to ...", "you should ..." |
| Courtesy after the order | "... for me", "... please", "... thanks", "... right now" |

| Stays a normal chat message | Examples |
|---|---|
| Statements and the speaker's own plans | "I'm getting paid on Friday", "I need to apply to more jobs", "I'm going to open it later" |
| Questions and status checks | "what jobs did you apply to?", "how did it go?", "is it possible to ..." |
| Negations and hypotheticals | "don't apply yet", "I don't want you to ...", "would you open Notepad if I asked?" |

Wording is cleaned up in `app/src/pcTasks/phrasing.ts`, then the strict protocol-2 grammar runs unchanged, so politeness never widens what can execute and a running worker validates every plan itself.

### Run-on-my-PC offers

When Eli states or asks for something chat cannot do (a payday for his calendar, a file to organize), the persona has the model end its reply with one `PC_TASK browser|computer: ...` line. The dashboard hides that line and shows it as a card with the exact task and a Run button (`app/public/pcOffer.js`). Nothing runs until Eli taps Run; the tap sends it as "In my Chrome, execute this task: ..." or "On my PC, execute this task: ...", validated like any typed command. The model's line is only a suggestion and is never executed on its own.

## Live view while the PC works

A running task shows that it is working, not just a status word. The PC activity card shows a pulsing indicator, the current step in plain words ("Opening linkedin.com", "Clicking", "Reading the page"), how long it has been working, how long ago the PC last reported in, and the last few steps. The page polls every 3 seconds while a task runs.

- The worker turns each agent tool event into a short sentence (`pc-worker/steps.ts`). Only the kind of step and a hostname appear: never typed text, commands, file contents or full URLs.
- Each new step is reported right away (at most every 2 seconds); the server keeps the last 12 distinct steps per task (`activity`).
- If the PC has been silent for over a minute the card turns amber and says the agent may be thinking or stuck.

## Windows startup crashes

On this PC, code injected into new processes sometimes crashes them at startup (access violation `0xC0000005` and similar). If an agent dies to one of those crash codes before it has run any tool or produced any result, nothing can have happened yet, so the worker starts it again, up to three attempts, and shows "crashed while starting, trying again" in the live view. A crash after a tool has run is never retried.

For local development, `npm run test:local` runs the app tests without a subprocess per test file, which avoids most random launch failures. CI uses the normal `npm test`.

## Job runs: keep going, every source, requested count

- **One blocked job never ends a run.** If a job needs a login, a visible CAPTCHA, an account, a legal attestation, or a question with no truthful approved answer, the agent abandons only that application, lists it under "Needs you" (company, role, link, the exact question) and moves on to the next suitable job until the requested number is submitted or none remain. A run with skips ends "Partly completed".
- **Every source, not only LinkedIn:** LinkedIn Easy Apply, company boards on Greenhouse, Lever and Ashby (no account needed), other boards and career pages. Postings are found with WebSearch/WebFetch (for example `site:boards.greenhouse.io`) and applied to in the signed-in Chrome. Portals that need an account (Workday, Taleo, iCIMS, Oracle) are skipped, and so is any company and role already in the log or tracker.
- **The count you ask for is the count it aims for.** The old local cap (`maxApplications` in `pc-worker.json`) silently turned "apply to 20" into 10 and is no longer used. The protocol still limits one task to 25.
- **Drafts are in the report.** When asked to draft messages or replies, the agent never sends or types them; each draft goes into its own evidence entry (`drafted`, who it is for, the full text), visible under Details. The agent's chat reply never reaches Jarvis, so a draft left only there was lost.

## Usage limits

The worker reports Claude's and Codex's 5-hour and weekly usage so the dashboard can show them live. Claude's numbers come from the `rate_limit_event` in each `claude -p` stream (and a tiny haiku probe after 30 idle minutes); Codex's come from the newest `rollout-*.jsonl` under `~/.jarvis/codex/sessions` and `~/.codex/sessions`. They travel as `limits` in the claim and heartbeat bodies, the server keeps the later reading per provider, and a window past its reset time shows as reset. Bad readings are ignored, so the worker never fails a task over them.

## Search CLIs in job runs

Job runs may run only `bun run .agents/skills/<freehire|jobbank|linkedin>-search/cli/src/cli.ts search ...` in a shell, from the jobs folder. Every other shell command is denied.

## Scheduled morning run

Jarvis queues one PC task every morning: "Apply to 10 job applications. Scheduled morning run." (`app/src/schedules/morning.ts`). It is a normal task, so the live view, reports, cancel and all safety rules apply, and the worker also finishes any applications already prepared in that day's report first (they count toward the 10).

- **When and how many:** `MORNING_RUN_TIME` (default `07:00`), `MORNING_RUN_COUNT` (default `10`, at most 25) and `MORNING_RUN_TZ` (default `America/Chicago`), set in `deploy/compose.yaml`. The PC worker token must be configured.
- **Once a day:** the request ID carries the date, so a restart can never queue it twice. It only queues in the three hours after the scheduled time, so deploying in the afternoon starts nothing.
- **PC off:** the task waits; if it is still waiting 12 hours later it is cancelled instead of running late.
- **Pause / Resume** on the dashboard's "On your radar" card (saved on the server), which also shows the next run and the last result.
- **My 6 AM Claude routine** (prepare-only) can keep running before it; the 7:00 AM Jarvis run submits.

## Direct requests and workspace continuation (local changes, 2026-10-19)

Explicit project continuation and LinkedIn drafting requests are routed before chat and need no second Run click. Suggested actions derived from statements still use an optional Run offer; model suggestions never authorize execution. Local worker settings must contain the requested workspace alias, for example `ezlynx` pointing to the existing EZLynx project. Unknown aliases fail with an explicit configuration message.

The worker avoids starting a provider whose fresh five-hour or weekly window is at least 90% used. Readings older than 35 minutes and elapsed reset windows do not block selection. It does not terminate active work solely because a percentage crosses 90%. If a code/workspace run exits at a quota after using tools, the worker saves a checkpoint and starts an available alternate against the same workspace, with instructions to inspect existing work and finish only missing steps. The checkpoint is local and contains task ID, prior agent, time and bounded progress. Cancellation, lost ownership and restart recovery still stop execution. Browser submissions and other uncertain external side effects are never automatically replayed.

Draft replies are placed in actual composers and left unsent unless report-only/no-typing is requested. Existing drafts must be preserved. Read full conversations, verify the exact recipient and visible text, and report non-editable sponsored messages rather than sending a response button.

Validation used simulated providers for a post-edit Claude-to-Codex handoff. Live activation remains blocked by Windows file/process access denial, and server routing changes have not been deployed. Do not describe this as a verified live cross-provider workflow yet.


## Ruflo project tools

Ruflo 3.57.1 is a private PC runtime, connected to workspace agents only. Nine tools provide task creation/status/updates/listing and project memory storage/retrieval/search/listing/stats. The adapter enforces the allowlist itself, refuses database path overrides, and checks the installed version. It does not expose shell, browser, federation, API-billed agent execution, or autonomous swarm tools. Actual work stays with the existing scoped Claude/Codex executor. Ruflo task records are not running workers and do not prove completion. Obsidian remains the personal memory source; project memory is not a vault mirror.

Use “Use Ruflo in my jarvis project to review the router” or a normal approved workspace request. Workspace instructions tell the agent to use Ruflo for larger tasks. Code/model approval review and sandbox restrictions still apply. Configured Codex workspace MCP tools request normal automatic approval review; the connection is required, so startup failures cannot silently pretend Ruflo was used.

Run `powershell -File pc-worker/activate-ruflo.ps1` from normal Windows PowerShell for checked activation. It verifies/installs the pinned private package, preserves settings and credentials while adding the EZLynx alias, saves separate ruflo-runtime.json metadata, and invokes the existing idle-only restart helper. It never changes platform permission policy or retries uncertain tasks. To disable Ruflo, set enabled=false in the private metadata and restart an idle worker. Installation uses --ignore-scripts and --omit=optional; tested task and SQL.js/HNSW memory features work on Windows without native builds.

Live verification: a Codex executor read the saved smoke-test memory and listed its task using jarvis-ruflo. Direct handlers also passed create, persist across process exit, retrieve and search checks. This verifies the executor connection, not activation of the long-running worker or real quota interruption. At this checkpoint Windows still denies protected settings writes and safe process inspection. Server dev deployment is tracked separately in the vault.


## Job files and retries

Codex jobs connect to a required jarvis-job-files MCP server as well as Chrome. It reads bounded approved job instructions, skill files, application history and resume text, lists approved directories and extracts text from actual PDFs. It rejects traversal, absolute paths, hidden credential files and realpath/symlink escapes. Only submission tasks expose the fixed application-log append tool; confirmed URLs are idempotent. The private PDF runtime is pdf-parse 2.4.5 under .jarvis/job-files (include optional native packages, ignore install scripts). Run `powershell.exe -NoProfile -ExecutionPolicy Bypass -File pc-worker/activate-job-files.ps1` from normal Windows PowerShell for installation and the existing safe idle-only worker restart.

The dashboard shows Why it stopped and a Try again button for terminal stopped/partial tasks. A click is an explicit new execution request, not a mutation of the old report. Duplicate clicks return the same retry. Partial submission runs subtract confirmed applications from the original maximum, keep original role/location constraints and check history/confirmations before repeating actions. Active, completed and uncertain connection-loss tasks cannot be blindly retried. A source task links to its retry so repeated clicks do not schedule duplicate runs.

Transient launch/connection failures before any possible action retry up to three attempts with backoff. Real access/approval denials do not retry or route around restrictions. Authentication, quota and missing-answer problems need their specific resolution. Explicit commands authorize the scoped work without another generic confirmation; full permission cannot change Windows or managed policy. Unknown interrupted submissions still need a result check.

Live check: the fixed Codex adapter successfully read documents/applications/log.md and extracted the actual Master-Resume.pdf (3 pages). It performed no browser activity, job submission or file edit. The long-running worker still needs activation because this session's process inspection is denied.


The Next workflow card reads the actual job schedule from /api/schedules. It does not hard-code 06:00 or describe a Claude-only plan. Scheduled tasks use the same least-used capable-provider selection as explicit PC tasks. The server chat engine chooser is separate; this change applies to the PC executor.

The dashboard date and clock use the device local timezone and refresh while open or on returning to the app. Times explicitly use 12-hour AM/PM, regardless of the device locale default. Schedule nextRun is an absolute instant displayed in the viewing device timezone, including its correct local day. Schedule execution still uses its configured timezone (Dallas by default); display changes do not move the scheduled job.


## Task scope, submission receipts and live dashboard updates

Task claims include the root request ID, original requested count and distinct confirmation URLs from that request/retry family. Application-history rows from another run do not fulfill a new quota. Pending receipts from an attempt count toward its retry budget, even if the agent's final report under-counted them.

Both job adapters receive the task-bound log/receipt tool. Call it after each observed new confirmation, not at batch end. A private durable outbox is saved before network delivery. The authenticated submission endpoint verifies the worker lease and submission plan, caps receipts, and deduplicates normalized URLs. Failed delivery is retried without repeating application actions. Server receipts are task observations; do not call a task created or a form filled a confirmed application.

The dashboard maintains an SSE connection at /api/live. Change notifications carry only topic/time; the browser reads its own current state. A shared read-only Google check runs every three seconds and pushes external sheet changes. Concurrent viewers share the same read, with 30-second backoff after errors. Job panels have a five-second fallback and refresh on reconnect/focus. Counts and rows always come from Google; local pending receipts appear separately and never inflate the tracker counts. Saved-copy/unavailable states are explicit. This is best-effort low latency, not a zero-latency guarantee or automatic sharing of every AI's internal conversation. These deterministic checks consume no AI tokens.

Google writes were explicitly approved on October 19 after the exact fields and permissions were presented. The existing tracker service account is Editor on this one sheet. Google writes contain only Company, Role, Date Applied, Stage and Posting URL; confirmation text and task IDs remain private. The deterministic writer finds existing URLs, preserves advanced/closed stages, uses literal cells, preserves native formatting/validation and reads back the result. An ambiguous response retains the receipt and checks the URL before retrying; retries back off from 30 seconds to five minutes. Google error messages are visible next to pending applications. The durable server journal resumes sync after a restart.

Job tasks for Claude and Codex have shared_job_state with exactly company, role, stage, URL and aggregate counts. Follow nextOffset for further pages. Calls require the current worker ID, task lease and a running job plan; they expose no Notes, CV, credentials or arbitrary sheet selection. Historical records prevent duplicates; they do not count toward a new request. The task-sync-v1 worker feature gates new retries; activate the current idle worker using activate-job-files.ps1 from normal PowerShell. Source/config tests pass, but the first live application-to-Google write still requires an activated worker and a real verified receipt.

## Personal tools for direct requests

Direct requests default to toolProfile=personal. Claude inherits user/project/local settings, plugins, skills, tool discovery and permission rules through the pinned Agent SDK 0.3.304. Codex uses app-server with the normal user .codex home/config. Neither runner disables configured apps/skills or overrides approval/sandbox policy. Jarvis MCP servers are additive, including Windows tools for the desktop adapter. Credentials are used in place, never copied to the repo. Server chat remains read-only.

Scheduled morning runs explicitly remain scoped; older tasks without a profile remain scoped, and retries preserve their profile. New personal requests require full-tools-v2, so old workers wait for activation. Job limits, confirmation receipts, Google synchronization, duplicate checks and evidence apply to both profiles.

The user explicitly approved Firecrawl search and scrape. Personal Claude runs receive only those two additional allow rules, without changing saved settings or overriding existing deny/ask rules. A real CLI diagnostic successfully called the connected Firecrawl search tool once against public documentation and returned docs.firecrawl.dev/introduction. Discovery alone is not execution. Context7 separately needs authorization; optional rea startup failed.

When either provider requests approval or input, PC activity shows the exact action with redacted credentials, an optional answer and Allow once / Deny. The provider stays paused and resumes the same turn only after the actual response. Connector form input requires an actual JSON answer; URL authentication remains a user action. Prompts expire after 15 minutes. Unknown requests, cancellation, missing ownership and relay failures fail closed. No automatic yes, session-wide grant or replay of uncertain submissions.

The request endpoint requires the worker bearer token and current task lease. Dashboard decisions require the private Tailscale access boundary, an HttpOnly SameSite browser-session cookie, same-origin JSON and a per-action HMAC token bound to the task, worker, lease and immutable request fingerprint. Tokens expire and cannot approve another action. No worker credential or lease goes to the browser. SSE publishes prompt changes; the worker checks responses every 1.5 seconds.

Codex MCP tool approvals arrive as form requests with an explicit empty object schema. These need an actual Allow/Deny decision and no text answer. After Allow, the worker returns action=accept, content={}. The server poll response encodes an empty object answer for older already-running workers, without generating a decision or changing the original action. Real form fields still require supplied answers. The UI hides the answer field for permission-only requests, shows labeled actual questions, and collapses technical details. This fixes the observed case where four saved Allow clicks incorrectly reached Codex as rejections.

The user explicitly requested one permanent consent instead of repeated tool prompts. PC activity's Always allow Jarvis tools saves that choice in private server state; Ask me again revokes it for subsequent undecided requests. It applies to existing and future personal tasks, including a worker currently polling. Ordinary Codex MCP permission forms and Claude configured MCP/file/web/skill tools use this stored consent and record decisionSource=saved-tool-consent. It does not fabricate factual answers, authorize connector sign-in, grant OS filesystem/network/sandbox escalations, override a prior Deny, or affect scheduled/scoped tasks. Tool and task constraints still run. A separate browser-session/state-bound preference capability protects changes; worker tokens and ordinary action tokens cannot enable it. No new worker restart or blanket CLI approval/sandbox override is introduced.

Validation covers HTTP approval ownership/session/CSRF, immutable decisions, expiry, cancellation, provider protocol responses, same-turn pause/resume and local browser form interaction. This managed Windows session refuses two-way child-process pipes (spawn EPERM), including a version-only Claude diagnostic. Normal Codex startup also hit state-database access denial. The SDK/app-server live approval round trip is therefore unverified here. No ACL or platform policy was changed. Activate the idle worker from normal PowerShell with activate-job-files.ps1, then verify the real provider round trip before calling the runtime proven.

Automatic review rejected the initial policy-override design and an approval endpoint lacking browser-session/CSRF/lease binding. The implementation above addresses both. Tool inheritance does not mean every connector is authenticated or every action is authorized.
