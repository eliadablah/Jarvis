# Dashboard and installed app

The main page offers Evergreen A, orange Daylight B, and Mission Control C. Auto uses the device's local clock: B from 06:00 to 11:30, A until 19:00, C overnight. Manual view selection persists; choose Auto or say “resume automatic views” to restore the cycle. Explicit ?design=a, b, or c links remain fixed previews.

Hold the microphone while speaking, then release. Typed and recognized commands share one handler. “Switch to view B”, “open dashboard”, “show my tasks”, “add task Study Network+”, and “complete Study Network+” work directly. Other questions go to the selected engine. Browser microphone permission is needed; support depends on the browser. Hardware microphone testing still needs the user's voice.

Tasks are saved privately under JARVIS_DATA_DIR, backed by the existing persistent home volume. They are not committed or written to the read-only vault. The task API requires same-origin JSON and the Jarvis request header for changes.

Auto selects Claude or Codex using the task and observed refusals. On usage, authentication, or availability failure before answer text, a compatible engine can take over. Provider conversation IDs stay separate. Exact remaining account tokens are not available through these CLI connections; the UI never estimates a balance. Cooldowns are process-local and bounded. A manual engine choice can retry early.

Codex may read Gmail and Google Calendar through explicit per-tool allowlists. Only tools relevant to the current question are loaded, reducing context overhead. Other apps and all write tools stay disabled. Email/event content is reference data, never instructions. Account questions do not fall back to an engine without account access. Authentication remains outside this public repository.

Bank balances, bill tracking, job-tracker data, and triggering the PC job runner are not yet connected to this dashboard. Existing job preparation stays in the user's Claude workflow. The dashboard states these gaps instead of displaying sample money or claiming submissions.

## Install as an app

The web manifest provides a standalone window, app name, and 192/512px icons. On desktop Chrome or Edge, open the private HTTPS dev site and use the browser's Install page as app / Install app control. An in-page Install Jarvis button appears in Models & permissions when the browser supplies an installation prompt. No installation is performed automatically.

Installed Jarvis still needs the private network/Tailscale and internet for its server, AI, and account tools. This release does not cache private chat/mail for offline access and is not a native background PC agent. Installation itself does not create PC-control permissions or make schedules execute while the app is closed.

The legacy full-screen face and Kokoro voice remain at /face-mode with upstream license credits.
