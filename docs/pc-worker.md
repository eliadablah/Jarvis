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

- Codex is preferred for approved local workspaces. It runs with workspace-write sandboxing and no approvals, with account apps and browser/desktop tools disabled.
- Claude provides workspace file/command fallback with explicitly allowed Bash, while unrelated MCP servers, nested agents and skills remain disabled for that adapter.
- Claude with Chrome handles browser actions and job tasks. Browser observation and browser execution are separate capabilities; execution can fill forms, edit Sheets, upload requested files, send requested messages and change requested calendar entries. Its login and Chrome extension must be connected. Search, prepare and submit are separate task scopes. Profile and answer-bank files are preloaded with content hashes.
- Claude Computer and Codex Computer use the pinned Windows-MCP stdio adapter for general desktop tasks and provide browser/job fallback. Registry tooling is not exposed; screenshots, app/input, file, PowerShell, process and clipboard tools are available for the requested task. No public/local HTTP service is started, telemetry is off, and platform sandbox profiles are preserved.
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
