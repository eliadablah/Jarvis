# PC tasks and local agents

Jarvis sends explicit PC requests to an authenticated Windows worker. The PC must be awake and signed in. The web server never receives desktop or shell tools.

## Requests

| Example | What can execute |
|---|---|
| Find support jobs but do not apply | Search only; no submissions |
| Prepare job applications for Acme | Local drafts; no submissions |
| Apply to three support jobs | Up to three submissions, within the local configured cap |
| Submit my prepared job applications for Acme | Only the named applications |
| Update my job tracker | Local tracker changes |
| In my Chrome, find the AWS documentation | Read and navigate in Chrome |
| In my assistant workspace, create a budget template | Files in that approved workspace |
| In my jarvis project, review the task router | The configured Jarvis project |
| Open Calculator / Notepad / File Explorer | Fixed Windows launcher, no model cost |
| Show PC activity | Open the activity panel |
| Cancel my PC task | Cancel the single active/queued task; use its button when several exist |

Vague requests to submit drafts ask which drafts. Discussion, status questions and negations do not execute. Unsupported Windows GUI operations need an additional adapter; the worker does not pretend it can click arbitrary apps.

## Agent choice

- Codex is preferred for approved local workspaces. It runs with workspace-write sandboxing and no approvals, with account apps and browser/desktop tools disabled.
- Claude provides file-only fallback in restricted mode. It cannot run commands or load skills in this adapter.
- Claude with Chrome handles browser and job tasks. Its login and Chrome extension must be connected. Search, prepare and submit are separate task scopes. Profile and answer-bank files are preloaded with content hashes.
- Windows directly launches the three supported apps.
- Numeric remaining tokens are unknown. Observed usage limits pause an agent for fifteen minutes; startup/auth failures pause it for one minute. Fallback happens only before any tools run. Nothing is retried automatically after a possible side effect.

## Results and recovery

The activity panel shows queued, running, stopping, completed, partly completed, needs-you and connection-lost states. Reports include agent-provided evidence and questions. A successful process exit does not mean the requested work succeeded. Application counts must match distinct confirmation URLs and the authorized cap. Zero confirmed submissions cannot be completed.

Workers heartbeat while running. Each task has an owner and secret claim lease; only that owner can report. Results are saved locally before delivery and retry idempotently after a connection failure. The worker never automatically repeats an interrupted action. Cancel asks the PC to stop its process tree; actions already performed remain.

A loopback port lock allows one protocol-2 worker per PC. Protocol-1 workers cannot claim new tasks. Old unscoped tasks need a new explicit request. An interrupted run with uncertain child processes puts the worker into a recovery hold. Review the application/files and stop any leftover agents before clearing recoveryHold in the local state file and restarting. Never simply requeue a task whose real outcome is unknown.

## Setup

Run from the repository:

    powershell -ExecutionPolicy Bypass -File pc-worker\install.ps1

Settings are private in %USERPROFILE%\.jarvis\pc-worker.json. Existing tokens and workspace aliases are preserved; only initial installation or explicit -RotateToken changes the token and requires redeploying the server. Approved workspace aliases map to absolute local paths. The assistant workspace defaults to %USERPROFILE%\.jarvis\workspace.

The installer sets up a pinned standalone official Codex CLI and a trusted CA bundle. Restart an idle worker after an update from a normal PowerShell window:

    powershell -ExecutionPolicy Bypass -File pc-worker/restart.ps1

A worker started inside another coding agent can inherit that agent’s read-only permission profile. Restarting from normal PowerShell or the registered logon task starts the worker with its configured workspace permissions. Never remove a managed permission profile inside a restricted session.

Use a standalone official Codex CLI for unattended work rather than the desktop app bundled alpha binary. Keep its auth/runtime cache separate in %USERPROFILE%\.jarvis\codex; authenticate that cache with the official Codex login flow. Credentials, settings, reports and caches never belong in the repository.

The worker uses private temporary files for agent stdin/stdout to avoid named-pipe EPERM failures seen on Windows. Temporary prompt/output files are removed after a confirmed exit. Its state/outbox and log stay in %USERPROFILE%\.jarvis.

## Checks

From app/: npm run typecheck, npm test, npm run test:pc, npm run build. CI runs both server and worker checks. The Linux image contains server code only; the worker runs on Windows.

No automatic job submissions, real emails, purchases or account changes are part of the integration smoke tests.
