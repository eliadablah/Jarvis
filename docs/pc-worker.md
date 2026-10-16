# PC worker: job applying

Jarvis's server can't use my browser, so errands that need it go to a small
worker on my Windows PC. Today that's one errand: finding and applying to jobs.

## How it works

1. I tell Jarvis something like "apply to DevOps jobs". The server queues the
   errand (`/api/pc/tasks`) and replies right away.
2. The worker (`pc-worker/worker.ts`) checks the queue every 30 seconds over
   Tailscale, using its own token.
3. It runs Claude Code headless with Chrome control (`claude -p --chrome`)
   inside my [ai-job-search](https://github.com/MadsLorentzen/ai-job-search)
   workspace (MIT). It searches LinkedIn (DFW and Remote, last 7 days), checks
   fit against my profile, tailors the CV following my resume rules, and
   submits LinkedIn Easy Apply applications in my signed-in Chrome, up to 10
   per run.
4. It posts a report back. "How did the job applying go?" reads it out.

## Guardrails

- Uses my existing Chrome sign-in. No LinkedIn password is stored anywhere.
- Stops a job and lists it under "Needs Eli" on a CAPTCHA, login, security
  check, external company site, or a question it can't answer truthfully from
  my profile.
- Job postings are treated as untrusted data; it never messages recruiters,
  changes my profile, or pays for anything.
- Every submitted application is logged in the workspace at
  `documents/applications/log.md`.
- My PC has to be on. Errands wait in the queue until it is.

LinkedIn's terms don't allow automated applying; I've accepted that risk for
my own account.

## Install (once)

```powershell
powershell -ExecutionPolicy Bypass -File pc-worker\install.ps1
```

It creates the worker token, saves it in `%USERPROFILE%\.jarvis\pc-worker.json`
(readable only by me) and as the GitHub secret `PC_WORKER_TOKEN`, and starts
the worker hidden at every sign-in. Redeploy dev afterwards so the server gets
the token. The log is `%USERPROFILE%\.jarvis\pc-worker.log`.
